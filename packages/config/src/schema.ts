import { z, type ZodType } from 'zod';
import { CONFIG_ROOT_SECTIONS, type ConfigRegistry } from './contracts.js';
import { getRegistryState } from './registry.js';

/** Stable identifier for the published complete Neottia configuration schema. */
export const CONFIG_JSON_SCHEMA_ID = 'https://neottia.dev/schema/config-v1.json';

interface SchemaPathNode {
  readonly children: Map<string, SchemaPathNode>;
  schema?: ZodType;
}

/** Composes canonical contribution paths into the strict root file schema. */
export function generateConfigJsonSchema(registry: ConfigRegistry): Readonly<Record<string, unknown>> {
  if (getRegistryState(registry) === undefined) {
    throw new TypeError('schema registry was not created by @neottia/config');
  }

  const configurableShape = createConfigurableShape(registry);
  const profileSchema = z.object(configurableShape).strict();
  const rootSchema = z
    .object({
      version: z.literal(1).describe('Neottia configuration format version.'),
      ...configurableShape,
      profiles: z
        .record(z.string().regex(/^\S(?:.*\S)?$/u), profileSchema)
        .optional()
        .describe('Named configuration fragments selected through NEOTTIA_PROFILE or the resolver API.'),
    })
    .strict()
    .describe('Complete Neottia configuration file. Unknown keys are rejected.');

  const generated = z.toJSONSchema(rootSchema, {
    target: 'draft-7',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  return Object.freeze({
    ...generated,
    $id: CONFIG_JSON_SCHEMA_ID,
    title: 'Neottia configuration',
  });
}

/** Builds every reserved root section, including strict empty unowned sections. */
function createConfigurableShape(registry: ConfigRegistry): Record<string, ZodType> {
  const roots = new Map<string, SchemaPathNode>(
    CONFIG_ROOT_SECTIONS.map((section) => [section, { children: new Map<string, SchemaPathNode>() }]),
  );
  for (const contribution of registry.contributions) {
    const [root, ...segments] = contribution.path;
    const rootNode = roots.get(root);
    if (rootNode === undefined) throw new TypeError(`configuration contribution has an unknown root section: ${root}`);
    let node: SchemaPathNode = rootNode;
    for (const segment of segments) {
      let child: SchemaPathNode | undefined = node.children.get(segment);
      if (child === undefined) {
        child = { children: new Map<string, SchemaPathNode>() };
        node.children.set(segment, child);
      }
      node = child;
    }
    node.schema = contribution.filePatchSchema;
  }

  return Object.fromEntries(
    [...roots].map(([section, node]) => [
      section,
      schemaForNode(node).optional().describe(`Canonical ${section} configuration.`),
    ]),
  );
}

/** Converts one validated ownership tree into nested strict object schemas. */
function schemaForNode(node: SchemaPathNode): ZodType {
  if (node.schema !== undefined) return node.schema;
  const shape = Object.fromEntries(
    [...node.children]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([segment, child]) => [segment, schemaForNode(child).optional()]),
  );
  return z.object(shape).strict();
}
