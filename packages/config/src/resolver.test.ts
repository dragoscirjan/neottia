import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CONFIG_ROOT_SECTIONS,
  ConfigResolutionError,
  MAX_CONFIG_DIAGNOSTICS,
  MAX_CONFIG_FILE_BYTES,
  MAX_CONFIG_YAML_DEPTH,
  MAX_CONFIG_YAML_NODES,
  createConfigRegistry,
  defineConfigContribution,
  resolveConfig,
  type ConfigResolutionError as ResolutionError,
} from './index.js';

const nestedPatchSchema = z
  .object({
    globalOnly: z.string().optional(),
    list: z.array(z.string()).optional(),
    object: z.object({ left: z.string().optional(), right: z.string().optional() }).strict().optional(),
    projectWins: z.string().optional(),
    profileWins: z.string().optional(),
    value: z.string().optional(),
  })
  .strict();
const patchSchema = z
  .object({
    count: z.number().int().optional(),
    enabled: z.boolean().optional(),
    nested: nestedPatchSchema.optional(),
    secret: z.string().optional(),
  })
  .strict();
const resolvedSchema = z
  .object({
    count: z.number().int(),
    enabled: z.boolean(),
    nested: z
      .object({
        globalOnly: z.string(),
        list: z.array(z.string()),
        object: z.object({ left: z.string(), right: z.string() }).strict(),
        projectWins: z.string(),
        profileWins: z.string(),
        value: z.string(),
      })
      .strict(),
    secret: z.string().optional(),
  })
  .strict();

const moduleContribution = defineConfigContribution({
  id: 'example',
  path: ['modules', 'example'],
  filePatchSchema: patchSchema,
  runtimePatchSchema: patchSchema,
  resolvedSchema,
  defaults: {
    count: 1,
    enabled: false,
    nested: {
      globalOnly: 'default',
      list: ['default'],
      object: { left: 'default-left', right: 'default-right' },
      profileWins: 'default',
      projectWins: 'default',
      value: 'default',
    },
  },
  environment: [
    { kind: 'integer', names: ['EXAMPLE_COUNT'], path: ['count'] },
    { kind: 'boolean', names: ['EXAMPLE_ENABLED'], path: ['enabled'] },
    { kind: 'string', names: ['EXAMPLE_VALUE', 'LEGACY_VALUE'], path: ['nested', 'value'] },
  ],
  legacyPaths: [['skills', 'example']],
  secrets: [{ fallbackEnvironment: ['EXAMPLE_SECRET_FALLBACK'], path: ['secret'] }],
});
const registry = createConfigRegistry([moduleContribution]);
const temporaryDirectories: string[] = [];

/** Creates an isolated integration-test workspace. */
function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'neottia-config-'));
  temporaryDirectories.push(directory);
  return directory;
}

/** Writes one test fixture without touching the repository worktree. */
function writeYaml(directory: string, name: string, source: string): string {
  const file = path.join(directory, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source, 'utf8');
  return file;
}

/** Captures a structured resolution error from an expected failure. */
function resolutionError(operation: () => unknown): ResolutionError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigResolutionError);
    return error as ResolutionError;
  }
  throw new Error('expected configuration resolution to fail');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

describe('layered configuration resolution', () => {
  it('applies defaults, global, project, profiles, environment, and overrides in the fixed order', () => {
    const cwd = temporaryDirectory();
    const globalFile = writeYaml(
      cwd,
      'global.yml',
      `version: 1
modules:
  example:
    nested:
      globalOnly: global
      projectWins: global
      profileWins: global
      value: global
profiles:
  ci:
    modules:
      example:
        nested:
          profileWins: global-profile
          value: global-profile
`,
    );
    const projectFile = writeYaml(
      cwd,
      'project.yml',
      `version: 1
modules:
  example:
    nested:
      projectWins: project
      profileWins: project
      value: project
profiles:
  ci:
    modules:
      example:
        nested:
          profileWins: project-profile
          value: project-profile
`,
    );

    const snapshot = resolveConfig(registry, {
      cwd,
      env: { EXAMPLE_COUNT: '7', EXAMPLE_VALUE: 'environment' },
      globalFile,
      overrides: { modules: { example: { enabled: true, nested: { value: 'override' } } } },
      profile: 'ci',
      projectFile,
    });
    const config = snapshot.get(moduleContribution);

    expect(config).toMatchObject({
      count: 7,
      enabled: true,
      nested: {
        globalOnly: 'global',
        profileWins: 'project-profile',
        projectWins: 'project',
        value: 'override',
      },
    });
    expect(snapshot.sourceOf(moduleContribution, ['nested', 'globalOnly'])).toMatchObject({ kind: 'global' });
    expect(snapshot.sourceOf(moduleContribution, ['nested', 'projectWins'])).toMatchObject({ kind: 'project' });
    expect(snapshot.sourceOf(moduleContribution, ['nested', 'profileWins'])).toMatchObject({
      kind: 'profile',
      profile: 'ci',
    });
    expect(snapshot.sourceOf(moduleContribution, ['count'])).toEqual({
      environment: 'EXAMPLE_COUNT',
      kind: 'environment',
    });
    expect(snapshot.sourceOf(moduleContribution, ['nested', 'value'])).toEqual({
      kind: 'override',
      label: 'explicit overrides',
    });
    expect(Object.isFrozen(config.nested)).toBe(true);
  });

  it('parses each source patch and final shard once during one resolution', () => {
    const cwd = temporaryDirectory();
    let patchParses = 0;
    let resolvedParses = 0;
    const countedPatch = z
      .object({ enabled: z.boolean().optional() })
      .strict()
      .transform((value) => {
        patchParses += 1;
        return value;
      });
    const countedResolved = z
      .object({ enabled: z.boolean() })
      .strict()
      .transform((value) => {
        resolvedParses += 1;
        return value;
      });
    const countedContribution = defineConfigContribution({
      defaults: { enabled: false },
      filePatchSchema: countedPatch,
      id: 'counted',
      path: ['modules', 'counted'],
      resolvedSchema: countedResolved,
      runtimePatchSchema: countedPatch,
    });
    const countedRegistry = createConfigRegistry([countedContribution]);
    patchParses = 0;
    resolvedParses = 0;
    const projectFile = writeYaml(cwd, 'counted.yml', 'version: 1\nmodules:\n  counted:\n    enabled: true\n');

    const snapshot = resolveConfig(countedRegistry, { cwd, env: {}, globalFile: false, projectFile });

    expect(snapshot.get(countedContribution).enabled).toBe(true);
    expect(patchParses).toBe(1);
    expect(resolvedParses).toBe(1);
  });

  it('merges mappings recursively while arrays and scalar subtrees replace lower values', () => {
    const cwd = temporaryDirectory();
    const globalFile = writeYaml(
      cwd,
      'global.yml',
      `version: 1
modules:
  example:
    nested:
      list: [global-one, global-two]
      object:
        left: global-left
`,
    );
    const projectFile = writeYaml(
      cwd,
      'project.yml',
      `version: 1
modules:
  example:
    nested:
      list: [project-only]
      object:
        right: project-right
`,
    );

    const config = resolveConfig(registry, { cwd, env: {}, globalFile, projectFile }).get(moduleContribution);

    expect(config.nested.list).toEqual(['project-only']);
    expect(config.nested.object).toEqual({ left: 'global-left', right: 'project-right' });
  });

  it('uses optional defaults and fails for explicitly selected missing files', () => {
    const cwd = temporaryDirectory();
    const defaults = resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile: false });
    expect(defaults.get(moduleContribution).count).toBe(1);
    expect(defaults.sourceOf(moduleContribution, ['count'])).toEqual({ kind: 'defaults' });

    const error = resolutionError(() =>
      resolveConfig(registry, { cwd, env: {}, globalFile: 'missing-global.yml', projectFile: false }),
    );
    expect(error.diagnostics).toMatchObject([{ code: 'IO' }]);
  });

  it.runIf(process.platform !== 'win32')('rejects a selected FIFO without waiting for a writer', () => {
    const cwd = temporaryDirectory();
    const fifo = path.join(cwd, 'config.fifo');
    execFileSync('mkfifo', [fifo]);
    const configModule = new URL('./index.ts', import.meta.url).href;
    const childScript = `
      import { ConfigResolutionError, createConfigRegistry, resolveConfig } from ${JSON.stringify(configModule)};
      try {
        resolveConfig(createConfigRegistry([]), {
          cwd: ${JSON.stringify(cwd)},
          env: {},
          globalFile: false,
          projectFile: ${JSON.stringify(fifo)},
        });
        process.exitCode = 2;
      } catch (error) {
        if (!(error instanceof ConfigResolutionError)) throw error;
        process.stdout.write(JSON.stringify(error.diagnostics));
      }
    `;

    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', childScript], {
      encoding: 'utf8',
      timeout: 2_000,
    });
    if (child.error !== undefined) throw child.error;

    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual([
      {
        code: 'IO',
        message: 'configuration file could not be read as a regular file',
        source: { file: fifo, kind: 'project' },
      },
    ]);
  });

  it('requires exact version 1 in every present configuration document', () => {
    const cwd = temporaryDirectory();
    const missingVersion = writeYaml(cwd, 'missing-version.yml', 'modules:\n  example:\n    count: 2\n');
    const invalidVersion = writeYaml(cwd, 'invalid-version.yml', 'version: "1"\n');

    expect(
      resolutionError(() => resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile: missingVersion }))
        .diagnostics,
    ).toMatchObject([{ code: 'VERSION', path: ['version'] }]);
    expect(
      resolutionError(() => resolveConfig(registry, { cwd, env: {}, globalFile: invalidVersion, projectFile: false }))
        .diagnostics,
    ).toMatchObject([{ code: 'VERSION', path: ['version'] }]);
  });

  it('discovers the project file from the injected invocation cwd', () => {
    const cwd = temporaryDirectory();
    writeYaml(cwd, '.neottia/config.yml', 'version: 1\nmodules:\n  example:\n    count: 9\n');

    const config = resolveConfig(registry, { cwd, env: {}, globalFile: false }).get(moduleContribution);

    expect(config.count).toBe(9);
  });

  it('rejects unknown keys even when a higher layer would replace the invalid patch', () => {
    const cwd = temporaryDirectory();
    const projectFile = writeYaml(
      cwd,
      'project.yml',
      'version: 1\nmodules:\n  example:\n    unknown: lower-secret-value\nunknownRoot:\n  ignored: false\n',
    );
    const error = resolutionError(() =>
      resolveConfig(registry, {
        cwd,
        env: {},
        globalFile: false,
        overrides: { modules: { example: { count: 4 } } },
        projectFile,
      }),
    );

    expect(error.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining(['PATH', 'SCHEMA']));
    expect(JSON.stringify(error)).not.toContain('lower-secret-value');
  });

  it('accepts empty reserved roots and rejects their unowned descendants in files and profiles', () => {
    const cwd = temporaryDirectory();
    const emptyRoots = Object.fromEntries(CONFIG_ROOT_SECTIONS.map((section) => [section, {}]));
    const validFile = writeYaml(
      cwd,
      'reserved-empty.yml',
      JSON.stringify({ version: 1, ...emptyRoots, profiles: { empty: emptyRoots } }),
    );

    expect(() => resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile: validFile })).not.toThrow();

    for (const section of CONFIG_ROOT_SECTIONS) {
      const invalidBase = writeYaml(
        cwd,
        `reserved-${section}.yml`,
        JSON.stringify({ version: 1, [section]: { unknown: {} } }),
      );
      expect(
        resolutionError(() => resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile: invalidBase }))
          .diagnostics,
      ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PATH', path: [section, 'unknown'] })]));

      const invalidProfile = writeYaml(
        cwd,
        `reserved-profile-${section}.yml`,
        JSON.stringify({ version: 1, profiles: { invalid: { [section]: { unknown: {} } } } }),
      );
      expect(
        resolutionError(() => resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile: invalidProfile }))
          .diagnostics,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'PROFILE', path: ['profiles', 'invalid', section, 'unknown'] }),
        ]),
      );
    }
  });

  it('can ignore only unregistered paths for deprecated standalone wrappers', () => {
    const cwd = temporaryDirectory();
    const projectFile = writeYaml(
      cwd,
      'compatibility.yml',
      'version: 1\nmodules:\n  example:\n    count: 4\n  another:\n    enabled: true\nlegacyHost:\n  command: ignored\n',
    );

    const snapshot = resolveConfig(registry, {
      compatibility: { ignoreUnregisteredPaths: true },
      cwd,
      env: {},
      globalFile: false,
      projectFile,
    });

    expect(snapshot.get(moduleContribution).count).toBe(4);

    const invalidOwnedShard = writeYaml(
      cwd,
      'invalid-owned.yml',
      'version: 1\nmodules:\n  example:\n    unknown: true\n  another:\n    ignored: true\n',
    );
    const error = resolutionError(() =>
      resolveConfig(registry, {
        compatibility: { ignoreUnregisteredPaths: true },
        cwd,
        env: {},
        globalFile: false,
        projectFile: invalidOwnedShard,
      }),
    );
    expect(error.diagnostics).toMatchObject([{ code: 'SCHEMA', path: ['modules', 'example', 'unknown'] }]);
  });
});

describe('profiles and source collisions', () => {
  it('composes same-name global and project profiles and lets explicit selection outrank the environment', () => {
    const cwd = temporaryDirectory();
    const globalFile = writeYaml(
      cwd,
      'global.yml',
      `version: 1
profiles:
  selected:
    modules:
      example:
        nested:
          object:
            left: selected-left
  ignored:
    modules:
      example:
        count: 2
`,
    );
    const projectFile = writeYaml(
      cwd,
      'project.yml',
      `version: 1
profiles:
  selected:
    modules:
      example:
        nested:
          object:
            right: selected-right
`,
    );

    const config = resolveConfig(registry, {
      cwd,
      env: { NEOTTIA_PROFILE: 'ignored' },
      globalFile,
      profile: 'selected',
      projectFile,
    }).get(moduleContribution);

    expect(config.nested.object).toEqual({ left: 'selected-left', right: 'selected-right' });
    expect(config.count).toBe(1);
  });

  it('rejects missing profiles and invalid unselected profile fragments', () => {
    const cwd = temporaryDirectory();
    const validFile = writeYaml(cwd, 'valid.yml', 'version: 1\nmodules:\n  example:\n    count: 2\n');
    expect(
      resolutionError(() =>
        resolveConfig(registry, { cwd, env: {}, globalFile: false, profile: 'missing', projectFile: validFile }),
      ).diagnostics,
    ).toMatchObject([{ code: 'PROFILE' }]);

    const invalidFile = writeYaml(
      cwd,
      'invalid.yml',
      'version: 1\nprofiles:\n  unused:\n    modules:\n      not_registered:\n        enabled: true\n',
    );
    const error = resolutionError(() =>
      resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile: invalidFile }),
    );
    expect(error.diagnostics).toMatchObject([{ code: 'PROFILE' }]);
  });

  it('rejects duplicate YAML keys and canonical-plus-legacy shard declarations', () => {
    const cwd = temporaryDirectory();
    const duplicateFile = writeYaml(
      cwd,
      'duplicate.yml',
      'version: 1\nmodules:\n  example:\n    count: 2\n    count: 3\n',
    );
    expect(
      resolutionError(() => resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile: duplicateFile }))
        .diagnostics,
    ).toMatchObject([{ code: 'YAML' }]);

    const collisionFile = writeYaml(
      cwd,
      'collision.yml',
      'version: 1\nmodules:\n  example:\n    count: 2\nskills:\n  example:\n    count: 3\n',
    );
    const collision = resolutionError(() =>
      resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile: collisionFile }),
    );
    expect(collision.diagnostics.some(({ code }) => code === 'MERGE')).toBe(true);
  });
});

describe('environment values, secrets, and safe diagnostics', () => {
  it('preserves legacy boolean environment spellings through generic coercion', () => {
    const cwd = temporaryDirectory();

    for (const value of ['true', ' TRUE ', '1']) {
      const snapshot = resolveConfig(registry, {
        cwd,
        env: { EXAMPLE_ENABLED: value },
        globalFile: false,
        projectFile: false,
      });
      expect(snapshot.get(moduleContribution).enabled).toBe(true);
    }
    for (const value of ['false', ' FALSE ', '0']) {
      const snapshot = resolveConfig(registry, {
        cwd,
        env: { EXAMPLE_ENABLED: value },
        globalFile: false,
        projectFile: false,
      });
      expect(snapshot.get(moduleContribution).enabled).toBe(false);
    }
  });

  it('uses the first populated environment alias and reports invalid coercion without its value', () => {
    const cwd = temporaryDirectory();
    const snapshot = resolveConfig(registry, {
      cwd,
      env: { EXAMPLE_VALUE: '', LEGACY_VALUE: 'legacy' },
      globalFile: false,
      projectFile: false,
    });
    expect(snapshot.get(moduleContribution).nested.value).toBe('legacy');

    const invalid = 'not-a-secret-number';
    const error = resolutionError(() =>
      resolveConfig(registry, {
        cwd,
        env: { EXAMPLE_COUNT: invalid },
        globalFile: false,
        projectFile: false,
      }),
    );
    expect(error.diagnostics).toMatchObject([{ code: 'ENVIRONMENT' }]);
    expect(JSON.stringify(error)).not.toContain(invalid);
  });

  it('rejects schema-invalid built-in values before higher overrides can hide their source', () => {
    const cwd = temporaryDirectory();
    const constrainedPatch = z
      .object({ count: z.number().int().min(1).max(10).optional(), mode: z.enum(['safe', 'strict']).optional() })
      .strict();
    const constrainedContribution = defineConfigContribution({
      id: 'constrained',
      path: ['modules', 'constrained'],
      filePatchSchema: constrainedPatch,
      runtimePatchSchema: constrainedPatch,
      resolvedSchema: z.object({ count: z.number().int().min(1).max(10), mode: z.enum(['safe', 'strict']) }).strict(),
      defaults: { count: 1, mode: 'safe' },
      environment: [
        { kind: 'integer', names: ['CONSTRAINED_COUNT'], path: ['count'] },
        { kind: 'string', names: ['CONSTRAINED_MODE'], path: ['mode'] },
      ],
    });
    const constrainedRegistry = createConfigRegistry([constrainedContribution]);

    const error = resolutionError(() =>
      resolveConfig(constrainedRegistry, {
        cwd,
        env: { CONSTRAINED_COUNT: '11', CONSTRAINED_MODE: 'unsafe' },
        globalFile: false,
        overrides: { modules: { constrained: { count: 2, mode: 'strict' } } },
        projectFile: false,
      }),
    );

    expect(error.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ENVIRONMENT',
          path: ['modules', 'constrained', 'count'],
          source: { environment: 'CONSTRAINED_COUNT', kind: 'environment' },
        }),
        expect.objectContaining({
          code: 'ENVIRONMENT',
          path: ['modules', 'constrained', 'mode'],
          source: { environment: 'CONSTRAINED_MODE', kind: 'environment' },
        }),
      ]),
    );
    expect(error.diagnostics.every(({ code }) => code === 'ENVIRONMENT')).toBe(true);
  });

  it('uses trusted environment parsers with canonical alias precedence', () => {
    const cwd = temporaryDirectory();
    const strategiesPatch = z.object({ strategies: z.array(z.string()).optional() }).strict();
    const transformedContribution = defineConfigContribution({
      id: 'transformed',
      path: ['modules', 'transformed'],
      filePatchSchema: strategiesPatch,
      runtimePatchSchema: strategiesPatch,
      resolvedSchema: z.object({ strategies: z.array(z.string()) }).strict(),
      defaults: { strategies: ['default'] },
      environment: [
        {
          kind: 'boolean',
          names: ['CANONICAL_FALLBACK', 'LEGACY_FALLBACK'],
          path: ['strategies'],
          parse: (value) => (/^(?:true|1)$/iu.test(value.trim()) ? ['direct', 'fallback'] : ['direct']),
        },
      ],
    });
    const transformedRegistry = createConfigRegistry([transformedContribution]);

    const snapshot = resolveConfig(transformedRegistry, {
      cwd,
      env: { CANONICAL_FALLBACK: 'true', LEGACY_FALLBACK: 'false' },
      globalFile: false,
      projectFile: false,
    });

    expect(snapshot.get(transformedContribution).strategies).toEqual(['direct', 'fallback']);
    expect(snapshot.sourceOf(transformedContribution, ['strategies'])).toEqual({
      environment: 'CANONICAL_FALLBACK',
      kind: 'environment',
    });
  });

  it('rejects invalid or throwing environment parsers without exposing raw values or failures', () => {
    const cwd = temporaryDirectory();
    const secretValue = 'raw-environment-secret';
    const thrownValue = 'parser-internal-secret';
    const parsedPatch = z.object({ count: z.number().int().optional() }).strict();
    const parsedContribution = defineConfigContribution({
      id: 'parsed',
      path: ['modules', 'parsed'],
      filePatchSchema: parsedPatch,
      runtimePatchSchema: parsedPatch,
      resolvedSchema: z.object({ count: z.number().int() }).strict(),
      defaults: { count: 1 },
      environment: [
        {
          kind: 'integer',
          names: ['PARSED_COUNT'],
          path: ['count'],
          parse: (value) => {
            if (value === secretValue) return 'not-an-integer';
            throw new Error(thrownValue);
          },
        },
      ],
    });
    const parsedRegistry = createConfigRegistry([parsedContribution]);

    for (const value of [secretValue, 'throw']) {
      const error = resolutionError(() =>
        resolveConfig(parsedRegistry, {
          cwd,
          env: { PARSED_COUNT: value },
          globalFile: false,
          projectFile: false,
        }),
      );
      expect(error.diagnostics).toMatchObject([
        {
          code: 'ENVIRONMENT',
          path: ['modules', 'parsed', 'count'],
          source: { environment: 'PARSED_COUNT', kind: 'environment' },
        },
      ]);
      expect(JSON.stringify(error)).not.toContain(secretValue);
      expect(JSON.stringify(error)).not.toContain(thrownValue);
    }
  });

  it('rejects file secret literals and unresolved exact references without leaking either value', () => {
    const cwd = temporaryDirectory();
    const literal = 'literal-super-secret';
    const literalFile = writeYaml(cwd, 'literal.yml', `version: 1\nmodules:\n  example:\n    secret: ${literal}\n`);
    const literalError = resolutionError(() =>
      resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile: literalFile }),
    );
    expect(literalError.diagnostics.some(({ code }) => code === 'SECRET')).toBe(true);
    expect(JSON.stringify(literalError)).not.toContain(literal);

    const referenceFile = writeYaml(
      cwd,
      'reference.yml',
      'version: 1\nmodules:\n  example:\n    secret: ${MISSING_SECRET}\n',
    );
    const referenceError = resolutionError(() =>
      resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile: referenceFile }),
    );
    expect(referenceError.diagnostics.some(({ code }) => code === 'SECRET')).toBe(true);
    expect(JSON.stringify(referenceError)).not.toContain('${MISSING_SECRET}');
  });

  it('resolves a winning exact reference once, redacts serialization, and retains only source metadata', () => {
    const cwd = temporaryDirectory();
    const projectFile = writeYaml(
      cwd,
      'project.yml',
      'version: 1\nmodules:\n  example:\n    secret: ${FIRST_SECRET}\n',
    );
    const resolvedValue = '${SECOND_SECRET}';
    const snapshot = resolveConfig(registry, {
      cwd,
      env: { FIRST_SECRET: resolvedValue, SECOND_SECRET: 'must-not-be-used' },
      globalFile: false,
      projectFile,
    });

    expect(snapshot.get(moduleContribution).secret).toBe(resolvedValue);
    expect(snapshot.sourceOf(moduleContribution, ['secret'])).toMatchObject({ kind: 'project' });
    expect(JSON.stringify(snapshot.sourceOf(moduleContribution, ['secret']))).not.toContain(resolvedValue);
    expect(snapshot.toJSON()).toMatchObject({ modules: { example: { secret: '[REDACTED]' } }, version: 1 });
    expect(JSON.stringify(snapshot.toJSON())).not.toContain(resolvedValue);
  });

  it('lets environment fallback and explicit runtime literals override file references', () => {
    const cwd = temporaryDirectory();
    const projectFile = writeYaml(cwd, 'project.yml', 'version: 1\nmodules:\n  example:\n    secret: ${FILE_SECRET}\n');
    const fallback = resolveConfig(registry, {
      cwd,
      env: { EXAMPLE_SECRET_FALLBACK: 'fallback-secret', FILE_SECRET: 'file-secret' },
      globalFile: false,
      projectFile,
    });
    expect(fallback.get(moduleContribution).secret).toBe('fallback-secret');
    expect(fallback.sourceOf(moduleContribution, ['secret'])).toEqual({
      environment: 'EXAMPLE_SECRET_FALLBACK',
      kind: 'environment',
    });

    const override = resolveConfig(registry, {
      cwd,
      env: {},
      globalFile: false,
      overrides: { modules: { example: { secret: 'trusted-runtime-secret' } } },
      projectFile,
    });
    expect(override.get(moduleContribution).secret).toBe('trusted-runtime-secret');
  });

  it('can resolve an override reference once for deprecated standalone wrappers', () => {
    const cwd = temporaryDirectory();
    const snapshot = resolveConfig(registry, {
      compatibility: { resolveOverrideSecretReferences: true },
      cwd,
      env: { FIRST_SECRET: '${SECOND_SECRET}', SECOND_SECRET: 'must-not-be-used' },
      globalFile: false,
      overrides: { modules: { example: { secret: '${FIRST_SECRET}' } } },
      projectFile: false,
    });

    expect(snapshot.get(moduleContribution).secret).toBe('${SECOND_SECRET}');
  });

  it('rejects oversized and structurally excessive YAML before value conversion', () => {
    const cwd = temporaryDirectory();
    const oversized = writeYaml(cwd, 'oversized.yml', `#${'x'.repeat(MAX_CONFIG_FILE_BYTES)}\n`);
    expect(
      resolutionError(() => resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile: oversized }))
        .diagnostics,
    ).toMatchObject([{ code: 'LIMIT' }]);

    let nested = 'leaf: true\n';
    for (let depth = 0; depth <= MAX_CONFIG_YAML_DEPTH; depth += 1) {
      nested = `level_${depth}:\n${nested
        .split('\n')
        .filter(Boolean)
        .map((line) => `  ${line}`)
        .join('\n')}\n`;
    }
    const deep = writeYaml(cwd, 'deep.yml', `version: 1\n${nested}`);
    expect(
      resolutionError(() => resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile: deep }))
        .diagnostics,
    ).toMatchObject([{ code: 'LIMIT' }]);

    const entries = Array.from({ length: MAX_CONFIG_YAML_NODES }, (_, index) => `key_${index}: true`).join('\n');
    const wide = writeYaml(cwd, 'wide.yml', `version: 1\n${entries}\n`);
    expect(
      resolutionError(() => resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile: wide }))
        .diagnostics,
    ).toMatchObject([{ code: 'LIMIT' }]);
  });

  it('bounds diagnostics and freezes their structured metadata', () => {
    const cwd = temporaryDirectory();
    const unknowns = Array.from({ length: 70 }, (_, index) => `unknown_${index}: true`).join('\n');
    const projectFile = writeYaml(cwd, 'many.yml', `version: 1\n${unknowns}\n`);
    const error = resolutionError(() => resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile }));

    expect(error.diagnostics).toHaveLength(MAX_CONFIG_DIAGNOSTICS);
    expect(error.diagnostics.at(-1)).toMatchObject({ code: 'LIMIT' });
    expect(Object.isFrozen(error.diagnostics)).toBe(true);
    expect(Object.isFrozen(error.diagnostics[0])).toBe(true);
  });
});
