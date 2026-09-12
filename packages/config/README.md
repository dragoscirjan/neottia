# @neottia/config

`@neottia/config` is the domain-neutral contract layer for Neottia configuration. Domain packages contribute their own schemas and defaults; a registry combines those contributions without importing any domain, MCP, or harness package. Resolved values are exposed as immutable typed shards.

This release establishes contribution registration and snapshot access. Layered YAML loading, profiles, provenance, environment resolution, and secret-reference resolution are added by the resolver separately. Consumers should not parse `.neottia/config.yml` themselves.

## Define a contribution

A contribution owns one canonical path beneath a registered root section. File and runtime patches use separate schemas so file-only rules, including secret references, can differ from trusted runtime overrides. Patch schemas must not inject defaults; the complete merged value is checked once with `resolvedSchema`.

```ts
import { defineConfigContribution } from "@neottia/config";
import { z } from "zod";

const patchSchema = z
  .object({
    enabled: z.boolean().optional(),
    token: z.string().optional(),
  })
  .strict();

const resolvedSchema = z
  .object({
    enabled: z.boolean(),
    token: z.string().optional(),
  })
  .strict();

export const exampleConfig = defineConfigContribution({
  id: "example",
  path: ["modules", "example"],
  filePatchSchema: patchSchema,
  runtimePatchSchema: patchSchema,
  resolvedSchema,
  defaults: { enabled: false },
  environment: [
    {
      path: ["enabled"],
      names: ["NEOTTIA_EXAMPLE_ENABLED"],
      kind: "boolean",
    },
  ],
  secrets: [
    {
      path: ["token"],
      fallbackEnvironment: ["NEOTTIA_EXAMPLE_TOKEN"],
    },
  ],
  legacyPaths: [["skills", "example"]],
});
```

Environment `names` are ordered from highest-priority canonical name to lower-priority compatibility aliases. Secret and environment `path` values are relative to the contribution shard. `legacyPaths` describe deprecated root paths; they do not change the canonical path returned by a resolver.

## Register contributions

```ts
import { createConfigRegistry } from "@neottia/config";
import { exampleConfig } from "./example-config.js";

export const registry = createConfigRegistry([exampleConfig]);
```

The registered root sections are:

- `modules`
- `sdlc`
- `connections`
- `capabilities`
- `agents`
- `harnesses`
- `assets`
- `templates`

`version` and `profiles` are root document metadata and cannot be owned by a contribution. Registration rejects empty IDs, invalid path segments, invalid defaults or bindings, duplicate IDs, exact duplicate paths, ancestor/descendant ownership, and canonical or legacy alias collisions. `ConfigRegistrationError.problems` is sorted deterministically and never includes rejected values.

## Access an immutable shard

Resolvers construct one snapshot for a coherent set of registered contributions. An embedding layer can construct the same boundary from already resolved values:

```ts
import { createConfigRegistry, createResolvedConfigSnapshot } from "@neottia/config";
import { exampleConfig } from "./example-config.js";

const registry = createConfigRegistry([exampleConfig]);
const snapshot = createResolvedConfigSnapshot(registry, {
  example: { enabled: true, token: "runtime-secret" },
});

export const config = snapshot.get(exampleConfig);
// config is DeepReadonly<{ enabled: boolean; token?: string }>.
```

Omitted shard IDs use the contribution defaults. Supplied shards are validated with `resolvedSchema`, cloned, and recursively frozen. Snapshot access accepts only the contribution object registered in that snapshot, preventing a same-ID contribution with an incompatible type from reading another module's value.

`createResolvedConfigSnapshot` is a trusted runtime boundary. It does not resolve or redact secret references; callers that construct snapshots directly must supply already resolved values and must not serialize them. The shared resolver owns those protections for file-based configuration.

## License

MIT
