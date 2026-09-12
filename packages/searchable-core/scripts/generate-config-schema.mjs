import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchableConfigFileSchema } from '../dist/config.js';

/** Writes the published credential-reference-only YAML contract. */
const output = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'config.schema.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(searchableConfigFileSchema.toJSONSchema({ io: 'input' }), null, 2)}\n`, 'utf8');
