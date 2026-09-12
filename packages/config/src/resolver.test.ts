import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ConfigResolutionError,
  MAX_CONFIG_DIAGNOSTICS,
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
      `modules:
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
    const projectFile = writeYaml(cwd, 'counted.yml', 'modules:\n  counted:\n    enabled: true\n');

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
      `modules:
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
      `modules:
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

  it('discovers the project file from the injected invocation cwd', () => {
    const cwd = temporaryDirectory();
    writeYaml(cwd, '.neottia/config.yml', 'modules:\n  example:\n    count: 9\n');

    const config = resolveConfig(registry, { cwd, env: {}, globalFile: false }).get(moduleContribution);

    expect(config.count).toBe(9);
  });

  it('rejects unknown keys even when a higher layer would replace the invalid patch', () => {
    const cwd = temporaryDirectory();
    const projectFile = writeYaml(
      cwd,
      'project.yml',
      'modules:\n  example:\n    unknown: lower-secret-value\nunknownRoot:\n  ignored: false\n',
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
});

describe('profiles and source collisions', () => {
  it('composes same-name global and project profiles and lets explicit selection outrank the environment', () => {
    const cwd = temporaryDirectory();
    const globalFile = writeYaml(
      cwd,
      'global.yml',
      `profiles:
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
      `profiles:
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
    const validFile = writeYaml(cwd, 'valid.yml', 'modules:\n  example:\n    count: 2\n');
    expect(
      resolutionError(() =>
        resolveConfig(registry, { cwd, env: {}, globalFile: false, profile: 'missing', projectFile: validFile }),
      ).diagnostics,
    ).toMatchObject([{ code: 'PROFILE' }]);

    const invalidFile = writeYaml(
      cwd,
      'invalid.yml',
      'profiles:\n  unused:\n    modules:\n      not_registered:\n        enabled: true\n',
    );
    const error = resolutionError(() =>
      resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile: invalidFile }),
    );
    expect(error.diagnostics).toMatchObject([{ code: 'PROFILE' }]);
  });

  it('rejects duplicate YAML keys and canonical-plus-legacy shard declarations', () => {
    const cwd = temporaryDirectory();
    const duplicateFile = writeYaml(cwd, 'duplicate.yml', 'modules:\n  example:\n    count: 2\n    count: 3\n');
    expect(
      resolutionError(() => resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile: duplicateFile }))
        .diagnostics,
    ).toMatchObject([{ code: 'YAML' }]);

    const collisionFile = writeYaml(
      cwd,
      'collision.yml',
      'modules:\n  example:\n    count: 2\nskills:\n  example:\n    count: 3\n',
    );
    const collision = resolutionError(() =>
      resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile: collisionFile }),
    );
    expect(collision.diagnostics.some(({ code }) => code === 'MERGE')).toBe(true);
  });
});

describe('environment values, secrets, and safe diagnostics', () => {
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

  it('rejects file secret literals and unresolved exact references without leaking either value', () => {
    const cwd = temporaryDirectory();
    const literal = 'literal-super-secret';
    const literalFile = writeYaml(cwd, 'literal.yml', `modules:\n  example:\n    secret: ${literal}\n`);
    const literalError = resolutionError(() =>
      resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile: literalFile }),
    );
    expect(literalError.diagnostics.some(({ code }) => code === 'SECRET')).toBe(true);
    expect(JSON.stringify(literalError)).not.toContain(literal);

    const referenceFile = writeYaml(cwd, 'reference.yml', 'modules:\n  example:\n    secret: ${MISSING_SECRET}\n');
    const referenceError = resolutionError(() =>
      resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile: referenceFile }),
    );
    expect(referenceError.diagnostics.some(({ code }) => code === 'SECRET')).toBe(true);
    expect(JSON.stringify(referenceError)).not.toContain('${MISSING_SECRET}');
  });

  it('resolves a winning exact reference once, redacts serialization, and retains only source metadata', () => {
    const cwd = temporaryDirectory();
    const projectFile = writeYaml(cwd, 'project.yml', 'modules:\n  example:\n    secret: ${FIRST_SECRET}\n');
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
    const projectFile = writeYaml(cwd, 'project.yml', 'modules:\n  example:\n    secret: ${FILE_SECRET}\n');
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

  it('bounds diagnostics and freezes their structured metadata', () => {
    const cwd = temporaryDirectory();
    const unknowns = Array.from({ length: 70 }, (_, index) => `unknown_${index}: true`).join('\n');
    const projectFile = writeYaml(cwd, 'many.yml', `${unknowns}\n`);
    const error = resolutionError(() => resolveConfig(registry, { cwd, env: {}, globalFile: false, projectFile }));

    expect(error.diagnostics).toHaveLength(MAX_CONFIG_DIAGNOSTICS);
    expect(error.diagnostics.at(-1)).toMatchObject({ code: 'LIMIT' });
    expect(Object.isFrozen(error.diagnostics)).toBe(true);
    expect(Object.isFrozen(error.diagnostics[0])).toBe(true);
  });
});
