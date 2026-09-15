import { lstat, readFile } from 'node:fs/promises';

import type { HostConfigLocator, TargetPath } from '@neottia/harness-adapter';

import { operationState, operationUnit, readHostUnit } from './host-config.js';
import {
  checksumBytes,
  journalPath,
  receiptEntryKey,
  receiptPath,
  resolveTarget,
  validateManifest,
  validateReceipt,
} from './manifest.js';
import type {
  AssetManifest,
  ContainerState,
  InstallRoots,
  InstallationReceipt,
  InstallationSnapshot,
  InspectedUnit,
  ReceiptEntry,
  UnitState,
} from './types.js';

/** Reads all paths needed by the pure install or update planner. */
export async function inspectInstallation(manifest: AssetManifest, roots: InstallRoots): Promise<InstallationSnapshot> {
  validateManifest(manifest);
  validateRoots(roots);
  const receiptFile = receiptPath(manifest.installationId, manifest.scope, roots);
  const receiptContainer = await readContainer(receiptFile);
  const receipt = parseReceipt(receiptContainer);
  if (
    receipt !== undefined &&
    (receipt.installationId !== manifest.installationId ||
      receipt.harnessId !== manifest.harnessId ||
      receipt.scope !== manifest.scope)
  ) {
    throw new TypeError('Existing receipt does not match the manifest identity.');
  }

  const receiptByKey = new Map((receipt?.entries ?? []).map((entry) => [receiptEntryKey(entry), entry]));
  const units: InspectedUnit[] = [];
  const desiredKeys = new Set<string>();
  for (const asset of manifest.assets) {
    if (asset.kind === 'file') {
      const path = resolveTarget(asset.target, roots);
      const container = await readContainer(path);
      const unit = { kind: 'file' as const };
      const key = receiptEntryKey({ target: asset.target, unit });
      desiredKeys.add(key);
      units.push({
        assetId: asset.id,
        target: asset.target,
        path,
        unit,
        desired: {
          exists: true,
          checksum: asset.checksum,
          encoding: asset.encoding,
          content: asset.content,
        },
        current: fileUnitState(container),
        container,
        source: asset.source,
        receipt: receiptByKey.get(key),
      });
      continue;
    }

    const target = await selectHostConfigTarget(asset.plan.target, roots);
    const path = resolveTarget(target, roots);
    const container = await readContainer(path);
    const text = container.exists ? decodeContainerText(container) : undefined;
    for (const operation of asset.plan.operations) {
      const unit = operationUnit(operation);
      const key = receiptEntryKey({ target, unit });
      desiredKeys.add(key);
      units.push({
        assetId: `${asset.id}.${operation.id}`,
        target,
        path,
        unit,
        desired: operationState(operation),
        current: readHostUnit(text, unit),
        container,
        source: asset.source,
        receipt: receiptByKey.get(key),
      });
    }
  }

  for (const entry of receipt?.entries ?? []) {
    const key = receiptEntryKey(entry);
    if (desiredKeys.has(key)) continue;
    units.push(await inspectReceiptEntry(entry, roots));
  }
  rejectDuplicateUnits(units);
  units.sort((left, right) => receiptEntryKey(left).localeCompare(receiptEntryKey(right)));

  return Object.freeze({
    roots: Object.freeze({ ...roots }),
    receiptPath: receiptFile,
    receiptContainer,
    ...(receipt === undefined ? {} : { receipt }),
    manifest,
    units: Object.freeze(units),
    pendingTransaction: await pathExists(journalPath(receiptFile)),
  });
}

/** Reads receipt-owned units for uninstall planning. */
export async function inspectUninstall(receiptFile: string, roots: InstallRoots): Promise<InstallationSnapshot> {
  validateRoots(roots);
  const receiptContainer = await readContainer(receiptFile);
  const receipt = parseReceipt(receiptContainer);
  if (receipt === undefined) throw new TypeError('Installation receipt does not exist.');
  const units = await Promise.all(receipt.entries.map((entry) => inspectReceiptEntry(entry, roots)));
  units.sort((left, right) => receiptEntryKey(left).localeCompare(receiptEntryKey(right)));
  return Object.freeze({
    roots: Object.freeze({ ...roots }),
    receiptPath: receiptFile,
    receiptContainer,
    receipt,
    units: Object.freeze(units),
    pendingTransaction: await pathExists(journalPath(receiptFile)),
  }) as InstallationSnapshot;
}

/** Selects the only existing host config or the adapter's creation path. */
async function selectHostConfigTarget(locator: HostConfigLocator, roots: InstallRoots): Promise<TargetPath> {
  const existing: TargetPath[] = [];
  for (const candidate of locator.candidates) {
    if ((await readContainer(resolveTarget(candidate, roots))).exists) existing.push(candidate);
  }
  if (existing.length > 1) throw new TypeError('More than one host configuration candidate exists.');
  return existing[0] ?? locator.createAt;
}

/** Reads one stale or uninstall receipt entry. */
async function inspectReceiptEntry(entry: ReceiptEntry, roots: InstallRoots): Promise<InspectedUnit> {
  const path = resolveTarget(entry.target, roots);
  const container = await readContainer(path);
  const current =
    entry.unit.kind === 'file'
      ? fileUnitState(container)
      : readHostUnit(container.exists ? decodeContainerText(container) : undefined, entry.unit);
  return {
    assetId: entry.assetId,
    target: entry.target,
    path,
    unit: entry.unit,
    current,
    container,
    receipt: entry,
  };
}

/** Reads exact bytes while rejecting links and special files. */
async function readContainer(path: string): Promise<ContainerState> {
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if (isMissing(error)) return Object.freeze({ path, exists: false });
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new TypeError(`Installer target is not a regular file: ${path}`);
  const bytes = await readFile(path);
  return Object.freeze({ path, exists: true, checksum: checksumBytes(bytes), content: bytes.toString('base64') });
}

/** Converts a containing file to the matching file ownership unit. */
function fileUnitState(container: ContainerState): UnitState {
  return container.exists
    ? Object.freeze({
        exists: true,
        checksum: container.checksum!,
        encoding: 'base64' as const,
        content: container.content!,
      })
    : Object.freeze({ exists: false });
}

/** Decodes text host configuration after an exact byte snapshot. */
function decodeContainerText(container: ContainerState): string {
  return Buffer.from(container.content!, 'base64').toString('utf8');
}

/** Parses and verifies a receipt container when present. */
function parseReceipt(container: ContainerState): InstallationReceipt | undefined {
  if (!container.exists) return undefined;
  let receipt: InstallationReceipt;
  try {
    receipt = JSON.parse(decodeContainerText(container)) as InstallationReceipt;
  } catch {
    throw new TypeError('Installation receipt is not valid JSON.');
  }
  validateReceipt(receipt);
  return Object.freeze(receipt);
}

/** Rejects repeated entry identities across manifest assets. */
function rejectDuplicateUnits(units: readonly InspectedUnit[]): void {
  const keys = new Set<string>();
  for (const unit of units) {
    const key = receiptEntryKey(unit);
    if (keys.has(key)) throw new TypeError('Installation units must be unique.');
    keys.add(key);
  }
}

/** Validates roots once before any filesystem access. */
function validateRoots(roots: InstallRoots): void {
  for (const [name, root] of Object.entries(roots)) {
    if (typeof root !== 'string' || root.length === 0 || !root.startsWith('/')) {
      throw new TypeError(`The ${name} root must be absolute.`);
    }
  }
}

/** Tests path presence without treating permission errors as absence. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/** Narrows Node's missing-path errors. */
function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
