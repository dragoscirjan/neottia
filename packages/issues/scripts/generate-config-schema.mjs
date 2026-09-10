import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { issueConfigSchema } from '../dist/config.js';

await writeFile(
  new URL('../config.schema.json', import.meta.url),
  `${JSON.stringify(z.toJSONSchema(issueConfigSchema), null, 2)}\n`,
);
