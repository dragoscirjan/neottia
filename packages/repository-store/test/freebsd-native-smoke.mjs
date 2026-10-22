import { spawn } from 'node:child_process';
import {
  closeSync,
  constants,
  existsSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const backend = require('../build/Release/repository_store_native.node');

if (process.argv[2] === 'worker') {
  try {
    backend.renameNoReplace(process.argv[3], process.argv[4]);
    process.exit(0);
  } catch (error) {
    if (error?.code === 'EEXIST') process.exit(17);
    console.error(error);
    process.exit(1);
  }
}

if (backend.platform !== 'freebsd') throw new Error(`Expected FreeBSD backend, received ${backend.platform}.`);
if (process.arch !== 'x64') throw new Error(`Expected x64, received ${process.arch}.`);

const root = mkdtempSync(join(tmpdir(), 'neottia-freebsd-native-'));
try {
  if (!backend.supportsLocalPath(root)) throw new Error(`Temporary directory is not on certified local UFS2: ${root}`);

  const synced = join(root, 'synced');
  writeFileSync(synced, 'durable');
  const fileDescriptor = openSync(synced, constants.O_RDONLY);
  try {
    backend.syncDescriptor(fileDescriptor);
  } finally {
    closeSync(fileDescriptor);
  }
  const directoryDescriptor = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    backend.syncDescriptor(directoryDescriptor);
  } finally {
    closeSync(directoryDescriptor);
  }

  const existingSource = join(root, 'existing-source');
  const existingDestination = join(root, 'existing-destination');
  writeFileSync(existingSource, 'source');
  writeFileSync(existingDestination, 'destination');
  let existingCode;
  try {
    backend.renameNoReplace(existingSource, existingDestination);
  } catch (error) {
    existingCode = error?.code;
  }
  if (existingCode !== 'EEXIST') throw new Error(`Expected EEXIST, received ${existingCode}.`);
  if (readFileSync(existingDestination, 'utf8') !== 'destination')
    throw new Error('Existing destination was replaced.');

  const directorySource = join(root, 'directory-source');
  mkdirSync(directorySource);
  let directoryCode;
  try {
    backend.renameNoReplace(directorySource, join(root, 'directory-destination'));
  } catch (error) {
    directoryCode = error?.code;
  }
  if (directoryCode !== 'ENOTSUP') throw new Error(`Expected ENOTSUP for a directory, received ${directoryCode}.`);

  const raceDestination = join(root, 'race-destination');
  const raceSources = Array.from({ length: 16 }, (_, index) => join(root, `race-source-${index}`));
  raceSources.forEach((source, index) => writeFileSync(source, `candidate-${index}`));
  const results = await Promise.all(
    raceSources.map(
      (source) =>
        new Promise((resolve, reject) => {
          const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'worker', source, raceDestination], {
            stdio: ['ignore', 'ignore', 'pipe'],
          });
          let stderr = '';
          child.stderr.setEncoding('utf8');
          child.stderr.on('data', (chunk) => (stderr += chunk));
          child.on('error', reject);
          child.on('exit', (code, signal) => resolve({ code, signal, source, stderr }));
        }),
    ),
  );
  const winners = results.filter((result) => result.code === 0 && result.signal === null);
  const collisions = results.filter((result) => result.code === 17 && result.signal === null);
  const unexpected = results.filter((result) => !winners.includes(result) && !collisions.includes(result));
  if (unexpected.length > 0) throw new Error(`Unexpected race worker result: ${JSON.stringify(unexpected)}`);
  if (winners.length !== 1 || collisions.length !== raceSources.length - 1)
    throw new Error(`Expected one winner and ${raceSources.length - 1} collisions.`);
  if (!existsSync(raceDestination)) throw new Error('Race destination was not published.');
  if (existsSync(winners[0].source)) throw new Error('Winning source name was not removed.');
  const winnerContent = readFileSync(raceDestination, 'utf8');
  if (!/^candidate-\d+$/u.test(winnerContent)) throw new Error('Race destination contains unexpected bytes.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
