import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const [binary, expectedPlatform] = process.argv.slice(2);
if (binary === undefined || expectedPlatform === undefined)
  throw new Error('Usage: node test/native-prebuild-smoke.mjs <binary> <platform>');

const require = createRequire(import.meta.url);
const backend = require(resolve(binary));
assert.equal(backend.platform, expectedPlatform);
assert.equal(typeof backend.renameNoReplace, 'function');
assert.equal(typeof backend.inspectLocalPath, 'function');
assert.equal(typeof backend.supportsLocalPath, 'function');
assert.equal(typeof backend.syncDescriptor, 'function');
const inspection = backend.inspectLocalPath(process.cwd());
assert.equal(typeof inspection.filesystemType, 'string');
for (const field of [
  'certified',
  'local',
  'writable',
  'hardLinks',
  'stableIdentity',
  'atomicNoReplace',
  'durability',
]) {
  assert.equal(typeof inspection[field], 'boolean');
}
console.log(`native prebuild smoke passed for ${expectedPlatform}`);
