import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import {
  HOST_FEATURES,
  type HarnessAdapter,
  type HarnessScope,
  type HostConfigOperation,
  type HostConfigPlan,
  type ProjectedFile,
  type TargetPath,
} from '@neottia/harness-adapter';

/** Disposable roots used to resolve every symbolic adapter anchor in tests. */
export interface TempHarnessEnvironment {
  readonly root: string;
  readonly projectRoot: string;
  readonly homeRoot: string;
  readonly xdgConfigRoot: string;
  readonly xdgDataRoot: string;
  cleanup(): void;
}

/** Creates project, home, and XDG roots beneath one temporary directory. */
export function createTempHarnessEnvironment(): TempHarnessEnvironment {
  const root = mkdtempSync(join(tmpdir(), 'neottia-adapter-'));
  const projectRoot = join(root, 'project');
  const homeRoot = join(root, 'home');
  const xdgConfigRoot = join(root, 'xdg-config');
  const xdgDataRoot = join(root, 'xdg-data');
  for (const path of [projectRoot, homeRoot, xdgConfigRoot, xdgDataRoot]) mkdirSync(path, { recursive: true });
  return {
    root,
    projectRoot,
    homeRoot,
    xdgConfigRoot,
    xdgDataRoot,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Resolves a symbolic target and proves that it stays inside its selected root. */
export function resolveHarnessTarget(environment: TempHarnessEnvironment, target: TargetPath): string {
  const base =
    target.anchor === 'project'
      ? environment.projectRoot
      : target.anchor === 'home'
        ? environment.homeRoot
        : environment.xdgConfigRoot;
  const absolute = resolve(base, ...target.segments);
  if (absolute !== base && !absolute.startsWith(`${base}${sep}`)) throw new Error('Projected path escaped its anchor.');
  if (absolute === base) throw new Error('Projected path must identify a file below its anchor.');
  return absolute;
}

/** Writes one projected file only inside a disposable harness environment. */
export function materializeProjectedFile(environment: TempHarnessEnvironment, file: ProjectedFile): string {
  const path = resolveHarnessTarget(environment, file.target);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, file.content, 'utf8');
  return path;
}

/** Applies semantic operations to a disposable JSON document for conformance tests. */
export function materializeHostConfigPlan(environment: TempHarnessEnvironment, plan: HostConfigPlan): string {
  const target = resolveHarnessTarget(environment, plan.target.createAt);
  mkdirSync(dirname(target), { recursive: true });
  const document = existsSync(target) ? parseObject(readFileSync(target, 'utf8')) : {};
  for (const operation of plan.operations) applyOperation(document, operation);
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return target;
}

/** Runs host-neutral deterministic and filesystem-safety checks for one adapter. */
export function assertHarnessAdapterConformance(adapter: HarnessAdapter): void {
  assert.deepEqual(Object.keys(adapter.declaration.features), [...HOST_FEATURES]);
  assert.equal(Object.isFrozen(adapter.declaration), true);
  assert.equal(Object.isFrozen(adapter.declaration.features), true);

  const environment = createTempHarnessEnvironment();
  try {
    const before = tree(environment.root);
    const promptRequest = {
      id: 'plan',
      scope: 'project' as const,
      body: 'Plan the requested change.\n',
      metadata: { description: 'Plan one change' },
    };
    const firstPrompt = adapter.projectPrompt(promptRequest);
    const secondPrompt = adapter.projectPrompt(promptRequest);
    assert.deepEqual(firstPrompt, secondPrompt);
    assert.equal(firstPrompt.diagnostics.length, 0);
    assert.ok(firstPrompt.value?.content.endsWith(promptRequest.body));
    assert.equal(Object.isFrozen(firstPrompt.value), true);

    const skillRequest = {
      id: 'code-review',
      scope: 'global' as const,
      description: 'Review code changes and report concrete findings.',
      body: '# Review\n\nInspect the changed code.\n',
      metadata: { owner: 'neottia' },
    };
    const skill = adapter.projectSkill(skillRequest);
    assert.equal(skill.diagnostics.length, 0);
    assert.ok(skill.value?.content.endsWith(skillRequest.body));

    const unsafe = adapter.projectPrompt({ ...promptRequest, id: '../plan' });
    assert.equal(unsafe.value, undefined);
    assert.ok(unsafe.diagnostics.some((diagnostic) => diagnostic.code === 'INVALID_ASSET_ID'));
    assert.deepEqual(tree(environment.root), before, 'Adapter methods must not mutate the filesystem.');

    if (firstPrompt.value !== undefined) {
      const path = materializeProjectedFile(environment, firstPrompt.value);
      assert.equal(path.startsWith(`${environment.projectRoot}${sep}`), true);
    }
    if (skill.value !== undefined) {
      const path = materializeProjectedFile(environment, skill.value);
      assert.equal(
        path.startsWith(`${environment.homeRoot}${sep}`) || path.startsWith(`${environment.xdgConfigRoot}${sep}`),
        true,
      );
    }

    for (const scope of ['project', 'global'] as const) assertSupportedTargets(adapter, scope);
  } finally {
    environment.cleanup();
  }
}

/** Verifies every supported target feature at one scope. */
function assertSupportedTargets(adapter: HarnessAdapter, scope: HarnessScope): void {
  for (const feature of [
    'asset.prompt',
    'asset.skill',
    'asset.extension',
    'asset.agent',
    'config.package',
    'config.mcp.local',
    'config.mcp.remote',
  ] as const) {
    const result = adapter.target({ feature, scope, assetId: feature.startsWith('asset.') ? 'test-asset' : undefined });
    const declared = adapter.declaration.features[feature];
    if (declared.status === 'supported' && declared.scopes.includes(scope)) {
      assert.ok(result.value, `${feature} must project when declared supported.`);
      assert.equal(result.diagnostics.length, 0);
    } else {
      assert.equal(result.value, undefined);
      assert.ok(result.diagnostics.length > 0, `${feature} must diagnose unsupported projection.`);
    }
  }
}

/** Applies one ownership-aware operation without replacing unrelated keys. */
function applyOperation(document: Record<string, unknown>, operation: HostConfigOperation): void {
  const key = pointerKey(operation.pointer);
  if (operation.kind === 'ensure-array-entry') {
    const current = document[key];
    if (current !== undefined && !Array.isArray(current)) throw new Error('Host config pointer is not an array.');
    const values = current === undefined ? [] : [...current];
    const index = values.findIndex((value) => packageIdentity(value) === operation.identity);
    if (index === -1) values.push(operation.value);
    else values[index] = operation.value;
    document[key] = values;
    return;
  }
  const current = document[key];
  if (current !== undefined && !plainObject(current)) throw new Error('Host config pointer is not an object.');
  document[key] = { ...(current ?? {}), [operation.key]: operation.value };
}

/** Accepts the shallow root pointers emitted by contract version 1. */
function pointerKey(pointer: string): string {
  if (!/^\/[A-Za-z0-9_-]+$/u.test(pointer)) throw new Error('Unsupported host config pointer.');
  return pointer.slice(1);
}

/** Matches versioned npm entries by stable package identity. */
function packageIdentity(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.startsWith('npm:') ? value.slice(4) : value;
  const separator = normalized.lastIndexOf('@');
  const name = separator > 0 ? normalized.slice(0, separator) : normalized;
  return `npm:${name}`;
}

/** Parses one test-only JSON configuration document. */
function parseObject(content: string): Record<string, unknown> {
  const value: unknown = JSON.parse(content);
  if (!plainObject(value)) throw new Error('Host configuration root must be an object.');
  return value;
}

/** Checks for a non-array JSON object. */
function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Captures deterministic relative paths without reading file contents. */
function tree(root: string, relative = ''): string[] {
  const path = join(root, relative);
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(relative, entry.name);
    return entry.isDirectory() ? [child, ...tree(root, child)] : [child];
  });
}
