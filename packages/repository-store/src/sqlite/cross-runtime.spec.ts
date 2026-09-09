import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('built-package SQLite runtime interoperability', () => {
  it('opens and rebuilds one disposable cache across Node and Bun', async () => {
    const authority = mkdtempSync(join(tmpdir(), 'neottia-cross-runtime-'));
    const fixture = fileURLToPath(new URL('../../test/cross-runtime.mjs', import.meta.url));
    try {
      await expect(runRuntime(process.execPath, fixture, 'rebuild', authority)).resolves.toBeUndefined();
      await expect(runRuntime('bun', fixture, 'verify', authority)).resolves.toBeUndefined();
      await expect(runRuntime('bun', fixture, 'rebuild', authority)).resolves.toBeUndefined();
      await expect(runRuntime(process.execPath, fixture, 'verify', authority)).resolves.toBeUndefined();
    } finally {
      rmSync(authority, { recursive: true, force: true });
    }
  }, 60_000);

  it('rolls an interrupted canonical transaction back across runtimes', async () => {
    const fixture = fileURLToPath(new URL('../../test/cross-runtime.mjs', import.meta.url));
    for (const [writer, reader] of [
      [process.execPath, 'bun'],
      ['bun', process.execPath],
    ] as const) {
      const authority = mkdtempSync(join(tmpdir(), 'neottia-cross-runtime-recovery-'));
      try {
        await expect(runRuntime(writer, fixture, 'crash-transaction', authority, 'SIGKILL')).resolves.toBeUndefined();
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
        await expect(runRuntime(reader, fixture, 'recover-transaction', authority)).resolves.toBeUndefined();
      } finally {
        rmSync(authority, { recursive: true, force: true });
      }
    }
  }, 60_000);
});

async function runRuntime(
  runtime: string,
  fixture: string,
  mode: string,
  authority: string,
  expectedSignal?: NodeJS.Signals,
): Promise<void> {
  await new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(runtime, [fixture, mode, authority], { stdio: ['ignore', 'ignore', 'pipe'] });
    let standardError = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      standardError += chunk;
    });
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if ((expectedSignal === undefined && code === 0) || signal === expectedSignal) resolveRun();
      else rejectRun(new Error(`${runtime} ${mode} exited ${code}/${signal}: ${standardError}`));
    });
  });
}
