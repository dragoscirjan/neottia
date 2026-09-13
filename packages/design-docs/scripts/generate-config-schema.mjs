import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { designDocsConfigFileSchema } from '../dist/config.js';

/** Publishes the complete standalone file-facing Design Docs shard schema. */
const output = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'config.schema.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(designDocsConfigFileSchema.toJSONSchema({ io: 'input' }), null, 2)}\n`, 'utf8');
