import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { designDocsConfigSchema } from '../dist/config.js';

/** Publishes the exact input schema accepted by skills.design_docs. */
const output = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'config.schema.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(designDocsConfigSchema.toJSONSchema({ io: 'input' }), null, 2)}\n`, 'utf8');
