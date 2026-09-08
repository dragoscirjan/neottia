import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryConfigFileSchema } from '../dist/config.js';

/** Writes the published YAML configuration contract from its Zod schema. */
const output = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'config.schema.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(memoryConfigFileSchema.toJSONSchema({ io: 'input' }), null, 2)}\n`, 'utf8');
