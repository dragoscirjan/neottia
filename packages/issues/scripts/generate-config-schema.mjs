import { writeFile } from 'node:fs/promises';
import { issueConfigFileSchema } from '../dist/config.js';

await writeFile(
  new URL('../config.schema.json', import.meta.url),
  `${JSON.stringify(issueConfigFileSchema.toJSONSchema(), null, 2)}\n`,
);
