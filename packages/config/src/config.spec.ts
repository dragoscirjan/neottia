import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CONFIG_ROOT_SECTIONS,
  ConfigRegistrationError,
  ConfigSnapshotError,
  createConfigRegistry,
  createResolvedConfigSnapshot,
  defineConfigContribution,
  generateConfigJsonSchema,
  type ConfigContribution,
  type RootSection,
} from './index.js';

const patchSchema = z.object({ enabled: z.boolean().optional() }).strict();
const resolvedSchema = z
  .object({ enabled: z.boolean(), nested: z.object({ labels: z.array(z.string()) }).strict() })
  .strict();

type Patch = z.output<typeof patchSchema>;
type Resolved = z.output<typeof resolvedSchema>;

/** Creates a valid contribution whose path can be changed by a collision test. */
function contribution(
  id: string,
  path: readonly [RootSection, ...string[]],
  options: Partial<ConfigContribution<Patch, Patch, Resolved>> = {},
): ConfigContribution<Patch, Patch, Resolved> {
  return {
    id,
    path,
    filePatchSchema: patchSchema,
    runtimePatchSchema: patchSchema,
    resolvedSchema,
    defaults: { enabled: false, nested: { labels: [] } },
    ...options,
  };
}

/** Extracts the stable registration error from a failing operation. */
function registrationError(operation: () => unknown): ConfigRegistrationError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigRegistrationError);
    return error as ConfigRegistrationError;
  }
  throw new Error('expected configuration registration to fail');
}

describe('configuration contribution registry', () => {
  it('registers every reserved root section and freezes public metadata', () => {
    const contributions = CONFIG_ROOT_SECTIONS.map((section) =>
      defineConfigContribution(contribution(section, [section, 'example'])),
    );
    const registry = createConfigRegistry(contributions);

    expect(registry.rootSections).toEqual([
      'modules',
      'sdlc',
      'connections',
      'capabilities',
      'agents',
      'harnesses',
      'assets',
      'templates',
    ]);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.rootSections)).toBe(true);
    expect(Object.isFrozen(registry.contributions)).toBe(true);
    expect(Object.isFrozen(registry.contributions[0].path)).toBe(true);
  });

  it('retains schemas, defaults, environment bindings, secrets, and legacy paths', () => {
    const source = contribution('memory', ['modules', 'memory'], {
      environment: [{ path: ['retrieval', 'limit'], names: ['NEOTTIA_MEMORY_LIMIT'], kind: 'integer' }],
      secrets: [{ path: ['provider', 'password'], fallbackEnvironment: ['PGPASSWORD'] }],
      legacyPaths: [['skills', 'memory']],
    });
    const defined = defineConfigContribution(source);

    expect(defined.filePatchSchema).toBe(patchSchema);
    expect(defined.runtimePatchSchema).toBe(patchSchema);
    expect(defined.resolvedSchema).toBe(resolvedSchema);
    expect(defined.environment?.[0]).toEqual({
      path: ['retrieval', 'limit'],
      names: ['NEOTTIA_MEMORY_LIMIT'],
      kind: 'integer',
    });
    expect(defined.secrets?.[0]).toEqual({ path: ['provider', 'password'], fallbackEnvironment: ['PGPASSWORD'] });
    expect(defined.legacyPaths).toEqual([['skills', 'memory']]);
    expect(Object.isFrozen(defined.defaults.nested.labels)).toBe(true);
    expect(Object.isFrozen(defined.environment)).toBe(true);
    expect(Object.isFrozen(defined.environment?.[0].names)).toBe(true);
    expect(Object.isFrozen(defined.secrets)).toBe(true);
    expect(Object.isFrozen(defined.legacyPaths)).toBe(true);
  });

  it('rejects duplicate IDs deterministically regardless of registration order', () => {
    const left = contribution('same', ['modules', 'left']);
    const right = contribution('same', ['modules', 'right']);

    const forward = registrationError(() => createConfigRegistry([left, right]));
    const reverse = registrationError(() => createConfigRegistry([right, left]));

    expect(forward.message).toBe(reverse.message);
    expect(forward.problems).toEqual(reverse.problems);
    expect(forward.problems).toContainEqual({
      code: 'DUPLICATE_ID',
      contributionId: 'same',
      message: 'duplicate contribution id "same"',
      path: undefined,
    });
  });

  it('rejects exact, overlapping, and alias path ownership', () => {
    const exact = registrationError(() =>
      createConfigRegistry([contribution('left', ['modules', 'same']), contribution('right', ['modules', 'same'])]),
    );
    expect(exact.problems.some(({ code }) => code === 'DUPLICATE_PATH')).toBe(true);

    const overlap = registrationError(() =>
      createConfigRegistry([
        contribution('parent', ['modules', 'records']),
        contribution('child', ['modules', 'records', 'child']),
      ]),
    );
    expect(overlap.problems.some(({ code }) => code === 'OVERLAPPING_PATH')).toBe(true);

    const alias = registrationError(() =>
      createConfigRegistry([
        contribution('current', ['modules', 'current'], { legacyPaths: [['skills', 'shared']] }),
        contribution('other', ['modules', 'other'], { legacyPaths: [['skills', 'shared']] }),
      ]),
    );
    expect(alias.problems.some(({ code }) => code === 'ALIAS_COLLISION')).toBe(true);
  });

  it('rejects invalid IDs, roots, segments, defaults, and binding metadata', () => {
    expect(() => defineConfigContribution(contribution(' ', ['modules', 'invalid']))).toThrow(ConfigRegistrationError);
    expect(() => defineConfigContribution(contribution('root', ['profiles' as RootSection, 'invalid']))).toThrow(
      /registered root section/u,
    );
    expect(() => defineConfigContribution(contribution('segment', ['modules', '']))).toThrow(
      /registered root section/u,
    );
    expect(() =>
      defineConfigContribution(
        contribution('defaults', ['modules', 'defaults'], { defaults: { enabled: false } as Resolved }),
      ),
    ).toThrow(/defaults/u);
    expect(() =>
      defineConfigContribution(
        contribution('binding', ['modules', 'binding'], {
          environment: [{ path: [], names: ['NEOTTIA_VALUE'], kind: 'string' }],
        }),
      ),
    ).toThrow(/environment binding/u);
    expect(() =>
      defineConfigContribution(
        contribution('secret', ['modules', 'secret'], {
          secrets: [{ path: ['secret'], fallbackEnvironment: [] as unknown as readonly [string, ...string[]] }],
        }),
      ),
    ).toThrow(/secret binding/u);
  });
});

describe('root JSON Schema generation', () => {
  it('composes canonical module paths and strict profile fragments', () => {
    const memory = defineConfigContribution(contribution('memory', ['modules', 'memory']));
    const issues = defineConfigContribution(contribution('issues', ['modules', 'issues']));
    const schema = generateConfigJsonSchema(createConfigRegistry([memory, issues])) as {
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
    };
    const modules = schema.properties?.modules as {
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
    };
    const profiles = schema.properties?.profiles as {
      additionalProperties?: { properties?: Record<string, unknown> };
    };
    const profileModules = profiles.additionalProperties?.properties?.modules as {
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
    };

    expect(schema).toMatchObject({
      $id: 'https://neottia.dev/schema/config-v1.json',
      additionalProperties: false,
      required: ['version'],
    });
    expect(Object.keys(modules.properties ?? {})).toEqual(['issues', 'memory']);
    expect(modules.additionalProperties).toBe(false);
    expect(Object.keys(profileModules.properties ?? {})).toEqual(['issues', 'memory']);
    expect(profileModules.additionalProperties).toBe(false);
    for (const section of CONFIG_ROOT_SECTIONS) {
      const baseSection = schema.properties?.[section] as { additionalProperties?: boolean };
      const profileSection = profiles.additionalProperties?.properties?.[section] as { additionalProperties?: boolean };
      expect(baseSection.additionalProperties).toBe(false);
      expect(profileSection.additionalProperties).toBe(false);
    }
  });

  it('rejects registries not created by the package', () => {
    expect(() => generateConfigJsonSchema({ rootSections: CONFIG_ROOT_SECTIONS, contributions: [] })).toThrow(
      /not created by @neottia\/config/u,
    );
  });
});

describe('resolved configuration snapshots', () => {
  it('provides typed immutable defaults and resolved shards', () => {
    const module = defineConfigContribution(contribution('module', ['modules', 'module']));
    const registry = createConfigRegistry([module]);
    const source = { enabled: true, nested: { labels: ['one'] } };
    const snapshot = createResolvedConfigSnapshot(registry, { module: source });
    const shard = snapshot.get(module);

    source.nested.labels.push('source-change');
    expect(shard).toEqual({ enabled: true, nested: { labels: ['one'] } });
    expect(Object.isFrozen(shard)).toBe(true);
    expect(Object.isFrozen(shard.nested)).toBe(true);
    expect(Object.isFrozen(shard.nested.labels)).toBe(true);
    expect(() => (shard.nested.labels as string[]).push('consumer-change')).toThrow(TypeError);
    expect(snapshot.get(module)).toBe(shard);

    const defaults = createResolvedConfigSnapshot(registry).get(module);
    expect(defaults).toEqual({ enabled: false, nested: { labels: [] } });
  });

  it('rejects unknown IDs, invalid resolved values, and unregistered contributions', () => {
    const module = defineConfigContribution(contribution('module', ['modules', 'module']));
    const registry = createConfigRegistry([module]);

    expect(() => createResolvedConfigSnapshot(registry, { other: {} })).toThrow(/unregistered shard "other"/u);
    expect(() => createResolvedConfigSnapshot(registry, { module: { enabled: 'yes' } })).toThrow(ConfigSnapshotError);

    const snapshot = createResolvedConfigSnapshot(registry);
    const lookalike = defineConfigContribution(contribution('module', ['modules', 'module']));
    expect(() => snapshot.get(lookalike)).toThrow(/not registered in this snapshot/u);
  });

  it('derives runtime overrides without mutating the declared snapshot', () => {
    const module = defineConfigContribution(contribution('module', ['modules', 'module']));
    const snapshot = createResolvedConfigSnapshot(createConfigRegistry([module]), {
      module: { enabled: false, nested: { labels: ['declared'] } },
    });

    const effective = snapshot.derive({ modules: { module: { enabled: true } } }, 'non-interactive host');

    expect(snapshot.get(module).enabled).toBe(false);
    expect(effective.get(module)).toEqual({ enabled: true, nested: { labels: ['declared'] } });
    expect(effective.sourceOf(module, ['enabled'])).toEqual({ kind: 'override', label: 'non-interactive host' });
    expect(() => effective.derive({ modules: { unknown: {} } }, 'invalid')).toThrow(/unregistered/u);
  });

  it('accepts the source contribution object when a registry normalizes raw metadata', () => {
    const source = contribution('module', ['modules', 'module']);
    const snapshot = createResolvedConfigSnapshot(createConfigRegistry([source]));

    expect(snapshot.get(source).enabled).toBe(false);
  });
});
