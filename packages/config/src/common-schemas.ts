import { z } from 'zod';

const stalePolicySchema = z.enum(['prompt', 'rebuild', 'fail']);

/** Builds the cache schema shared by repository-backed modules. */
export function createCacheConfigSchema(options: { readonly strict?: boolean } = {}) {
  const schema = z.object({
    max_age_ms: z.number().int().nonnegative().default(300_000),
    stale_policy: stalePolicySchema.default('prompt'),
  });
  return options.strict === false ? schema.prefault({}) : schema.strict().prefault({});
}

/** Builds the default-free cache schema used for layered patches. */
export function createCacheConfigPatchSchema(options: { readonly strict?: boolean } = {}) {
  const schema = z.object({
    max_age_ms: z.number().int().nonnegative().optional(),
    stale_policy: stalePolicySchema.optional(),
  });
  return options.strict === false ? schema.optional() : schema.strict().optional();
}
