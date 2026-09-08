import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { memoryConfigSchema } from '../dist/config.js';

/** Writes the published configuration contract from the runtime Zod schema. */
const output = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'config.schema.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(memoryConfigSchema.toJSONSchema({ io: 'input' }), null, 2)}\n`, 'utf8');
