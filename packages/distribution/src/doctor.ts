import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { delimiter, extname, join } from 'node:path';

import { resolveTarget } from './manifest.js';
import type { AssetManifest, DoctorResult, InstallationSnapshot, InstallRoots, Prerequisite } from './types.js';

/** Checks declared external requirements without installing or changing them. */
export async function runDoctor(
  manifest: AssetManifest,
  roots: InstallRoots,
  env: NodeJS.ProcessEnv = process.env,
): Promise<readonly DoctorResult[]> {
  const results: DoctorResult[] = [];
  for (const prerequisite of manifest.prerequisites) {
    const available = await checkPrerequisite(prerequisite, roots, env);
    results.push({
      id: prerequisite.id,
      category: prerequisite.category,
      status: available ? 'ok' : 'error',
      message: available ? `${prerequisite.description} is available.` : `${prerequisite.description} is missing.`,
      ...(available ? {} : { instructions: prerequisite.instructions }),
    });
  }
  return Object.freeze(
    results.sort((left, right) => left.id.localeCompare(right.id)).map((result) => Object.freeze(result)),
  );
}

/** Reports receipt drift and pending recovery from an existing snapshot. */
export function diagnoseSnapshot(snapshot: InstallationSnapshot): readonly DoctorResult[] {
  const results: DoctorResult[] = [];
  if (snapshot.pendingTransaction) {
    results.push({
      id: 'receipt.pending-transaction',
      category: 'receipt',
      status: 'error',
      message: 'An interrupted installer transaction needs recovery.',
      instructions: `Run neottia recover --receipt ${snapshot.receiptPath}`,
    });
  }
  for (const unit of snapshot.units) {
    if (unit.receipt !== undefined && (!unit.current.exists || unit.current.checksum !== unit.receipt.checksum)) {
      results.push({
        id: `receipt.drift.${unit.assetId}`,
        category: 'receipt',
        status: 'error',
        message: `Receipt-owned unit has changed: ${unit.path}`,
        instructions: 'Review the file and approve its exact conflict ID in a new plan if replacement is intended.',
      });
    }
  }
  if (results.length === 0) {
    results.push({
      id: 'receipt.state',
      category: 'receipt',
      status: 'ok',
      message: 'Installation receipts and owned units are consistent.',
    });
  }
  return Object.freeze(results.map((result) => Object.freeze(result)));
}

/** Runs one bounded prerequisite probe. */
async function checkPrerequisite(
  prerequisite: Prerequisite,
  roots: InstallRoots,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  const check = prerequisite.check;
  if (check.kind === 'environment') return typeof env[check.variable] === 'string' && env[check.variable]!.length > 0;
  if (check.kind === 'path') return accessible(resolveTarget(check.target, roots));
  if (check.kind === 'package') {
    try {
      createRequire(import.meta.url).resolve(check.packageName);
      return true;
    } catch {
      return false;
    }
  }
  return commandAvailable(check.command, env);
}

/** Finds an executable using PATH and PATHEXT without invoking a shell. */
async function commandAvailable(command: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  if (command.includes('/') || command.includes('\\')) return accessible(command, constants.X_OK);
  const paths = (env.PATH ?? '').split(delimiter).filter((entry) => entry.length > 0);
  const extensions =
    process.platform === 'win32' && extname(command) === '' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : [''];
  for (const path of paths) {
    for (const extension of extensions) {
      if (await accessible(join(path, `${command}${extension}`), constants.X_OK)) return true;
    }
  }
  return false;
}

/** Tests one path while treating access failures as a missing prerequisite. */
async function accessible(path: string, mode: number = constants.F_OK): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}
