import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResolvedConfigSnapshot } from '@neottia/config';
import { resolveHostConfigSnapshot } from '@neottia/config-registry';

/** Module-shaped patch accepted by disposable unified configuration fixtures. */
export interface ConfigFixtureModules {
  readonly memory?: Readonly<Record<string, unknown>>;
  readonly issues?: Readonly<Record<string, unknown>>;
  readonly designDocs?: Readonly<Record<string, unknown>>;
  readonly searchable?: Readonly<Record<string, unknown>>;
}

export interface CreateConfigFixtureOptions {
  readonly global?: ConfigFixtureModules;
  readonly project?: ConfigFixtureModules;
  readonly secondProject?: ConfigFixtureModules;
  readonly profile?: { readonly name: string; readonly modules: ConfigFixtureModules };
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly overrides?: Readonly<Record<string, unknown>>;
}

/** Complete isolated source stack for shared resolver and host conformance tests. */
export interface ConfigFixture {
  readonly root: string;
  readonly cwds: readonly [string, string];
  readonly globalConfigPath: string;
  readonly projectConfigPaths: readonly [string, string];
  readonly env: Readonly<Record<string, string | undefined>>;
  resolve(cwd?: string, overrides?: Readonly<Record<string, unknown>>): ResolvedConfigSnapshot;
  cleanup(): void;
}

/** Creates global, project, profile, environment, override, and multi-cwd inputs under one temp root. */
export function createConfigFixture(options: CreateConfigFixtureOptions = {}): ConfigFixture {
  const root = mkdtempSync(join(tmpdir(), 'neottia-config-fixture-'));
  const first = join(root, 'project-a');
  const second = join(root, 'project-b');
  const globalConfigPath = join(root, 'xdg-config', 'neottia', 'config.yml');
  const firstConfig = join(first, '.neottia', 'config.yml');
  const secondConfig = join(second, '.neottia', 'config.yml');
  for (const file of [globalConfigPath, firstConfig, secondConfig]) mkdirSync(join(file, '..'), { recursive: true });

  writeDocument(globalConfigPath, options.global ?? {}, options.profile);
  writeDocument(firstConfig, options.project ?? {});
  writeDocument(secondConfig, options.secondProject ?? options.project ?? {});
  const env = Object.freeze({
    XDG_CONFIG_HOME: join(root, 'xdg-config'),
    ...(options.profile ? { NEOTTIA_PROFILE: options.profile.name } : {}),
    ...(options.env ?? {}),
  });

  return {
    root,
    cwds: [first, second],
    globalConfigPath,
    projectConfigPaths: [firstConfig, secondConfig],
    env,
    resolve(cwd = first, overrides = options.overrides) {
      return resolveHostConfigSnapshot({
        cwd,
        env,
        interactive: true,
        ...(overrides ? { overrides } : {}),
      });
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** JSON is emitted because it is valid YAML and preserves nested fixture values exactly. */
function writeDocument(
  file: string,
  modules: ConfigFixtureModules,
  profile?: CreateConfigFixtureOptions['profile'],
): void {
  const document = {
    version: 1,
    modules: moduleDocument(modules),
    ...(profile ? { profiles: { [profile.name]: { modules: moduleDocument(profile.modules) } } } : {}),
  };
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

function moduleDocument(modules: ConfigFixtureModules): Record<string, unknown> {
  return {
    ...(modules.memory ? { memory: modules.memory } : {}),
    ...(modules.issues ? { issues: modules.issues } : {}),
    ...(modules.designDocs ? { design_docs: modules.designDocs } : {}),
    ...(modules.searchable ? { searchable: modules.searchable } : {}),
  };
}
