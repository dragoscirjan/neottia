import assert from 'node:assert/strict';
import {
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.platform !== 'win32') process.exit(0);

const require = createRequire(import.meta.url);
const backend = require('../build/Release/repository_store_native.node');
const root = mkdtempSync(join(tmpdir(), 'repository-store-windows-native-'));
try {
  console.log('windows native smoke: platform');
  assert.equal(backend.platform, 'win32');
  console.log('windows native smoke: filesystem');
  assert.equal(backend.supportsLocalPath(root), true);

  const source = join(root, 'source.txt');
  const destination = join(root, 'destination.txt');
  writeFileSync(source, 'source');
  const descriptor = openSync(source, 'r+');
  let identityBefore;
  try {
    console.log('windows native smoke: flush');
    fsyncSync(descriptor);
    identityBefore = fstatSync(descriptor);
  } finally {
    closeSync(descriptor);
  }

  console.log('windows native smoke: rename');
  backend.renameNoReplace(source, destination);
  const identityAfter = lstatSync(destination);
  console.log('windows native smoke: identity');
  assert.deepEqual(pickIdentity(identityAfter), pickIdentity(identityBefore));
  assert.equal(readFileSync(destination, 'utf8'), 'source');

  writeFileSync(source, 'collision');
  console.log('windows native smoke: collision');
  assert.throws(() => backend.renameNoReplace(source, destination), { code: 'EEXIST' });
  assert.equal(readFileSync(destination, 'utf8'), 'source');
  assert.equal(readFileSync(source, 'utf8'), 'collision');
} finally {
  rmSync(root, { recursive: true, force: true });
}

function pickIdentity(stat) {
  return { birthtimeMs: stat.birthtimeMs, dev: stat.dev, ino: stat.ino };
}
