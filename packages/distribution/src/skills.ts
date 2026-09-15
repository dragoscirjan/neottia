import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, lstat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { targetPath } from '@neottia/harness-adapter';

import { checksumBytes, checksumText } from './manifest.js';
import type { FileAsset, StageExternalSkillsOptions } from './types.js';

const DEFAULT_LIMITS = Object.freeze({ maxFiles: 500, maxBytes: 8 * 1024 * 1024 });

/** Uses the external `skills` package only inside an isolated staging project. */
export async function stageExternalSkills(options: StageExternalSkillsOptions): Promise<readonly FileAsset[]> {
  const limits = options.limits ?? DEFAULT_LIMITS;
  if (limits.maxFiles < 1 || limits.maxBytes < 1) throw new TypeError('External skill limits must be positive.');
  const stage = await mkdtemp(join(tmpdir(), 'neottia-skills-'));
  const project = join(stage, 'project');
  const home = join(stage, 'home');
  const xdgConfig = join(stage, 'xdg-config');
  const xdgState = join(stage, 'xdg-state');
  await Promise.all([mkdir(project), mkdir(home), mkdir(xdgConfig), mkdir(xdgState)]);

  try {
    const skillsBin = options.skillsBin ?? resolveSkillsBin();
    const arguments_ = [
      skillsBin,
      'add',
      options.request.source,
      '--agent',
      'universal',
      '--copy',
      '--yes',
      ...options.request.skills.flatMap((skill) => ['--skill', skill]),
    ];
    await run(process.execPath, arguments_, project, {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: xdgConfig,
      XDG_STATE_HOME: xdgState,
    });

    const stagedRoot = join(project, '.agents', 'skills');
    const stagedFiles: Array<{ skill: string; relativePath: string; bytes: Buffer }> = [];
    for (const skill of [...options.request.skills].sort((left, right) => left.localeCompare(right))) {
      const skillRoot = join(stagedRoot, skill);
      const files = await readRegularTree(skillRoot, limits, stagedFiles.length, byteLength(stagedFiles));
      for (const file of files) stagedFiles.push({ skill, relativePath: file.relativePath, bytes: file.bytes });
    }
    const integrity = directoryChecksum(stagedFiles);
    if (integrity !== options.request.integrity) throw new TypeError('Staged external skill integrity does not match.');

    const assets: FileAsset[] = [];
    for (const file of stagedFiles) {
      const projected = options.adapter.target({
        feature: 'asset.skill',
        scope: options.request.scope,
        assetId: file.skill,
      });
      if (projected.value === undefined || 'candidates' in projected.value) {
        throw new TypeError(`Harness adapter cannot target static skill ${file.skill}.`);
      }
      const base = projected.value.segments.slice(0, -1);
      const segments = file.relativePath.split('/');
      const utf8 = decodeUtf8(file.bytes);
      const encoding = utf8 !== undefined && !utf8.includes('\0') && !utf8.includes('\r') ? 'utf8' : 'base64';
      const content = encoding === 'utf8' ? utf8! : file.bytes.toString('base64');
      const pathDigest = checksumText(`${file.skill}/${file.relativePath}`).slice(
        'sha256:'.length,
        'sha256:'.length + 16,
      );
      assets.push({
        kind: 'file',
        id: `external-skill.${options.request.id}.${pathDigest}`,
        target: targetPath(projected.value.anchor, [...base, ...segments]),
        encoding,
        content,
        checksum: checksumBytes(file.bytes),
        source: {
          kind: 'external-skill',
          id: options.request.id,
          version: options.request.revision,
          checksum: options.request.integrity,
          packageName: 'skills',
        },
      });
    }
    return Object.freeze(
      assets.sort((left, right) => left.id.localeCompare(right.id)).map((asset) => deepFreeze(asset)),
    );
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

/** Resolves the direct dependency's local CLI instead of downloading a package. */
export function resolveSkillsBin(): string {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve('skills/package.json');
  return join(dirname(packageJson), 'bin', 'cli.mjs');
}

/** Computes the exact digest expected in static skill configuration. */
export function externalSkillIntegrity(
  files: readonly { readonly skill: string; readonly relativePath: string; readonly bytes: Uint8Array }[],
): ReturnType<typeof checksumBytes> {
  const hashInput = Buffer.concat(
    [...files]
      .sort((left, right) => `${left.skill}/${left.relativePath}`.localeCompare(`${right.skill}/${right.relativePath}`))
      .flatMap((file) => [
        Buffer.from(`${file.skill}/${file.relativePath}\0`, 'utf8'),
        Buffer.from(file.bytes),
        Buffer.from('\0'),
      ]),
  );
  return checksumBytes(hashInput);
}

/** Runs one argv-safe subprocess and rejects non-zero exits. */
async function run(command: string, arguments_: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, arguments_, { cwd, env, shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
    const errors: Buffer[] = [];
    let errorBytes = 0;
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error === undefined) resolvePromise();
      else reject(error);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('The skills command exceeded its two-minute time limit.'));
    }, 120_000);
    child.stderr.on('data', (chunk: Buffer) => {
      errorBytes += chunk.length;
      if (errorBytes > 64 * 1024) {
        child.kill('SIGKILL');
        finish(new Error('The skills command exceeded its diagnostic output limit.'));
        return;
      }
      errors.push(chunk);
    });
    child.once('error', (error) => finish(error));
    child.once('close', (code) => {
      if (code === 0) finish();
      else
        finish(
          new Error(
            `The skills command failed with exit code ${String(code)}: ${Buffer.concat(errors).toString('utf8')}`,
          ),
        );
    });
  });
}

/** Reads a staged skill without following links or accepting special files. */
async function readRegularTree(
  root: string,
  limits: { readonly maxFiles: number; readonly maxBytes: number },
  initialFiles: number,
  initialBytes: number,
): Promise<readonly { readonly relativePath: string; readonly bytes: Buffer }[]> {
  const output: Array<{ relativePath: string; bytes: Buffer }> = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw new TypeError('Staged external skills cannot contain symbolic links.');
      if (stat.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!stat.isFile()) throw new TypeError('Staged external skills can contain only regular files.');
      const bytes = await readFile(path);
      output.push({ relativePath: relative(root, path).split('\\').join('/'), bytes });
      if (initialFiles + output.length > limits.maxFiles || initialBytes + byteLength(output) > limits.maxBytes) {
        throw new TypeError('Staged external skill exceeds configured limits.');
      }
    }
  };
  await visit(root);
  return output;
}

/** Totals staged bytes without reading files again. */
function byteLength(files: readonly { readonly bytes: Uint8Array }[]): number {
  return files.reduce((total, file) => total + file.bytes.byteLength, 0);
}

/** Creates one deterministic digest for all requested skill directories. */
function directoryChecksum(
  files: readonly { readonly skill: string; readonly relativePath: string; readonly bytes: Uint8Array }[],
) {
  return externalSkillIntegrity(files);
}

/** Decodes UTF-8 only when every byte sequence is valid. */
function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** Recursively freezes detached staged assets. */
function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
    return Object.freeze(value);
  }
  return value;
}
