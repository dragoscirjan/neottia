import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';

import type { ProjectedFile, TargetPath } from '@neottia/harness-adapter';

import type {
  AssetManifest,
  AssetManifestInput,
  AssetSource,
  FileAsset,
  HostConfigAsset,
  InstallRoots,
  InstallationReceipt,
  ReceiptEntry,
  Sha256,
} from './types.js';

const STABLE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

/** Creates a canonical immutable manifest and computes its digest. */
export function createAssetManifest(input: AssetManifestInput): AssetManifest {
  const canonical = {
    schemaVersion: 1 as const,
    installationId: input.installationId,
    owner: 'neottia' as const,
    producer: structuredClone(input.producer),
    harnessId: input.harnessId,
    scope: input.scope,
    configChecksum: input.configChecksum,
    templates: [...input.templates].sort((left, right) => left.id.localeCompare(right.id)),
    prerequisites: [...input.prerequisites].sort((left, right) => left.id.localeCompare(right.id)),
    assets: [...input.assets].sort((left, right) => left.id.localeCompare(right.id)),
    ...(input.reloadNotice === undefined ? {} : { reloadNotice: structuredClone(input.reloadNotice) }),
  };
  const manifest = { ...canonical, checksum: checksumText(canonicalJson(canonical)) };
  validateManifest(manifest);
  return deepFreeze(structuredClone(manifest));
}

/** Wraps one text projection from a harness adapter as a checksummed asset. */
export function fileAssetFromProjection(projected: ProjectedFile, source: AssetSource): FileAsset {
  const asset: FileAsset = {
    kind: 'file',
    id: `${projected.feature}.${projected.assetId}`,
    target: structuredClone(projected.target),
    encoding: 'utf8',
    content: projected.content,
    checksum: checksumText(projected.content),
    source: structuredClone(source),
  };
  validateFileAsset(asset);
  return deepFreeze(asset);
}

/** Creates immutable source metadata and verifies its exact source digest. */
export function createAssetSource(
  input: Omit<AssetSource, 'checksum'> & { readonly content: string | Uint8Array },
): AssetSource {
  const source: AssetSource = {
    kind: input.kind,
    id: input.id,
    version: input.version,
    checksum: typeof input.content === 'string' ? checksumText(input.content) : checksumBytes(input.content),
    ...(input.packageName === undefined ? {} : { packageName: input.packageName }),
  };
  validateSource(source);
  return deepFreeze(source);
}

/** Validates a decoded manifest and every embedded checksum. */
export function validateManifest(manifest: AssetManifest): void {
  if (manifest.schemaVersion !== 1 || manifest.owner !== 'neottia')
    throw new TypeError('Manifest schema is unsupported.');
  validateStableId(manifest.installationId, 'Installation ID');
  validateStableId(manifest.harnessId, 'Harness ID');
  if (!nonblank(manifest.producer.name) || !nonblank(manifest.producer.version)) {
    throw new TypeError('Manifest producer is invalid.');
  }
  if (manifest.scope !== 'project' && manifest.scope !== 'global') throw new TypeError('Manifest scope is invalid.');
  validateChecksum(manifest.configChecksum, 'Configuration checksum');
  if (!Array.isArray(manifest.assets) || !Array.isArray(manifest.templates) || !Array.isArray(manifest.prerequisites)) {
    throw new TypeError('Manifest collections are invalid.');
  }

  const ids = new Set<string>();
  const fileTargets = new Set<string>();
  const configUnits = new Set<string>();
  for (const asset of manifest.assets) {
    validateStableId(asset.id, 'Asset ID');
    if (ids.has(asset.id)) throw new TypeError('Manifest asset IDs must be unique.');
    ids.add(asset.id);
    validateSource(asset.source);
    if (asset.kind === 'file') {
      validateFileAsset(asset);
      const key = portableTargetKey(asset.target);
      if (fileTargets.has(key)) throw new TypeError('Manifest file targets must be unique.');
      fileTargets.add(key);
    } else {
      validateHostConfigAsset(asset, manifest.harnessId, manifest.scope);
      for (const operation of asset.plan.operations) {
        const identity =
          operation.kind === 'ensure-array-entry'
            ? `${operation.pointer}:array:${operation.identity}`
            : `${operation.pointer}:object:${operation.key}`;
        const key = `${asset.plan.target.createAt.anchor}:${asset.plan.target.createAt.segments.join('/')}:${identity}`;
        if (configUnits.has(key)) throw new TypeError('Manifest host configuration units must be unique.');
        configUnits.add(key);
      }
    }
  }

  const { checksum: declaredChecksum, ...unsigned } = manifest;
  validateChecksum(declaredChecksum, 'Manifest checksum');
  if (checksumText(canonicalJson(unsigned)) !== declaredChecksum)
    throw new TypeError('Manifest checksum does not match.');
}

/** Creates a canonical immutable ownership receipt. */
export function createReceipt(input: Omit<InstallationReceipt, 'schemaVersion' | 'checksum'>): InstallationReceipt {
  const unsigned = {
    schemaVersion: 1 as const,
    installationId: input.installationId,
    manifestChecksum: input.manifestChecksum,
    harnessId: input.harnessId,
    scope: input.scope,
    entries: [...input.entries].sort((left, right) => receiptEntryKey(left).localeCompare(receiptEntryKey(right))),
  };
  const receipt = { ...unsigned, checksum: checksumText(canonicalJson(unsigned)) };
  validateReceipt(receipt);
  return deepFreeze(structuredClone(receipt));
}

/** Validates receipt ownership evidence decoded from disk. */
export function validateReceipt(receipt: InstallationReceipt): void {
  if (receipt.schemaVersion !== 1) throw new TypeError('Receipt schema is unsupported.');
  validateStableId(receipt.installationId, 'Receipt installation ID');
  validateStableId(receipt.harnessId, 'Receipt harness ID');
  validateChecksum(receipt.manifestChecksum, 'Receipt manifest checksum');
  validateChecksum(receipt.checksum, 'Receipt checksum');
  if (receipt.scope !== 'project' && receipt.scope !== 'global') throw new TypeError('Receipt scope is invalid.');
  if (!Array.isArray(receipt.entries)) throw new TypeError('Receipt entries must be an array.');
  const keys = new Set<string>();
  for (const entry of receipt.entries) {
    validateReceiptEntry(entry);
    const key = receiptEntryKey(entry);
    if (keys.has(key)) throw new TypeError('Receipt entries must be unique.');
    keys.add(key);
  }
  const { checksum: declaredChecksum, ...unsigned } = receipt;
  if (checksumText(canonicalJson(unsigned)) !== declaredChecksum)
    throw new TypeError('Receipt checksum does not match.');
}

/** Resolves one adapter path beneath the matching explicit root. */
export function resolveTarget(target: TargetPath, roots: InstallRoots): string {
  validateTarget(target);
  const root = target.anchor === 'project' ? roots.project : target.anchor === 'home' ? roots.home : roots.xdgConfig;
  if (!isAbsolute(root)) throw new TypeError(`The ${target.anchor} root must be absolute.`);
  const resolvedRoot = resolve(root);
  const destination = resolve(resolvedRoot, ...target.segments);
  const relation = relative(resolvedRoot, destination);
  if (relation.startsWith('..') || isAbsolute(relation)) throw new TypeError('Target escapes its root.');
  return destination;
}

/** Returns the local-state receipt path for one installation. */
export function receiptPath(installationId: string, scope: AssetManifest['scope'], roots: InstallRoots): string {
  validateStableId(installationId, 'Installation ID');
  const root =
    scope === 'project' ? resolve(roots.project, '.neottia', 'install') : resolve(roots.xdgState, 'neottia', 'install');
  return resolve(root, `${installationId}.receipt.json`);
}

/** Returns the transaction journal associated with a receipt. */
export function journalPath(receipt: string): string {
  return `${receipt}.transaction.json`;
}

/** Hashes exact text bytes. */
export function checksumText(content: string): Sha256 {
  return checksumBytes(Buffer.from(content, 'utf8'));
}

/** Hashes exact bytes. */
export function checksumBytes(content: Uint8Array): Sha256 {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

/** Encodes deterministic JSON with sorted keys and a final LF. */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

/** Converts an embedded asset to exact bytes. */
export function fileAssetBytes(asset: FileAsset): Buffer {
  return Buffer.from(asset.content, asset.encoding);
}

/** Creates a portable key for a target. */
export function targetKey(target: TargetPath): string {
  return `${target.anchor}:${target.segments.join('/')}`;
}

/** Creates a stable key for one receipt-owned unit. */
export function receiptEntryKey(entry: Pick<ReceiptEntry, 'target' | 'unit'>): string {
  const unit =
    entry.unit.kind === 'file'
      ? 'file'
      : entry.unit.kind === 'array-entry'
        ? `array:${entry.unit.pointer}:${entry.unit.identity}`
        : `object:${entry.unit.pointer}:${entry.unit.key}`;
  return `${targetKey(entry.target)}:${unit}`;
}

/** Validates a projected file and its exact content digest. */
function validateFileAsset(asset: FileAsset): void {
  validateTarget(asset.target);
  if (asset.encoding !== 'utf8' && asset.encoding !== 'base64') throw new TypeError('File asset encoding is invalid.');
  if (typeof asset.content !== 'string') throw new TypeError('File asset content is invalid.');
  const bytes = fileAssetBytes(asset);
  if (checksumBytes(bytes) !== asset.checksum) throw new TypeError('File asset checksum does not match.');
  if (asset.encoding === 'utf8' && (asset.content.includes('\0') || asset.content.includes('\r'))) {
    throw new TypeError('Text assets must use LF content without NUL bytes.');
  }
}

/** Checks host plan identity without interpreting host-specific values. */
function validateHostConfigAsset(asset: HostConfigAsset, hostId: string, scope: AssetManifest['scope']): void {
  if (asset.plan.hostId !== hostId || asset.plan.scope !== scope)
    throw new TypeError('Host configuration plan does not match its manifest.');
  validateTarget(asset.plan.target.createAt);
  if (!Array.isArray(asset.plan.target.candidates) || !Array.isArray(asset.plan.operations)) {
    throw new TypeError('Host configuration plan is invalid.');
  }
  for (const candidate of asset.plan.target.candidates) validateTarget(candidate);
  for (const operation of asset.plan.operations) {
    if (operation.owner !== 'neottia' || !nonblank(operation.id) || !operation.pointer.startsWith('/')) {
      throw new TypeError('Host configuration operation is invalid.');
    }
  }
}

/** Validates one persisted receipt entry. */
function validateReceiptEntry(entry: ReceiptEntry): void {
  if (!nonblank(entry.assetId) || entry.owner !== 'neottia') throw new TypeError('Receipt entry identity is invalid.');
  validateTarget(entry.target);
  validateSource(entry.source);
  validateChecksum(entry.checksum, 'Receipt entry checksum');
  if (entry.unit.kind !== 'file') {
    if (!entry.unit.pointer.startsWith('/')) throw new TypeError('Receipt host configuration pointer is invalid.');
    const identity = entry.unit.kind === 'array-entry' ? entry.unit.identity : entry.unit.key;
    if (!nonblank(identity)) throw new TypeError('Receipt host configuration identity is invalid.');
  }
  if (entry.previous.kind === 'displaced') {
    validateChecksum(entry.previous.checksum, 'Displaced content checksum');
    if (!['utf8', 'base64', 'json'].includes(entry.previous.encoding) || typeof entry.previous.content !== 'string') {
      throw new TypeError('Displaced content is invalid.');
    }
  }
}

/** Validates source metadata before it becomes ownership evidence. */
function validateSource(source: AssetSource): void {
  if (!STABLE_ID.test(source.id) || !nonblank(source.version)) throw new TypeError('Asset source metadata is invalid.');
  validateChecksum(source.checksum, 'Asset source checksum');
  if (source.packageName !== undefined && !nonblank(source.packageName))
    throw new TypeError('Source package name is invalid.');
}

/** Validates symbolic paths received from persisted JSON. */
function validateTarget(target: TargetPath): void {
  if (!['project', 'home', 'xdg-config'].includes(target.anchor)) throw new TypeError('Target anchor is invalid.');
  if (!Array.isArray(target.segments) || target.segments.length === 0) throw new TypeError('Target path is empty.');
  for (const segment of target.segments) {
    if (
      !nonblank(segment) ||
      segment === '.' ||
      segment === '..' ||
      /[/\\\0]/u.test(segment) ||
      segment.normalize('NFC') !== segment
    ) {
      throw new TypeError('Target path contains an unsafe segment.');
    }
  }
}

/** Normalizes case and compatibility characters for collision checks. */
function portableTargetKey(target: TargetPath): string {
  return targetKey(target).normalize('NFKC').toLocaleLowerCase('en-US');
}

/** Validates stable manifest IDs. */
function validateStableId(id: string, label: string): void {
  if (!STABLE_ID.test(id)) throw new TypeError(`${label} is invalid.`);
}

/** Validates the common digest form. */
function validateChecksum(value: string, label: string): asserts value is Sha256 {
  if (!SHA256.test(value)) throw new TypeError(`${label} is invalid.`);
}

/** Checks required strings. */
function nonblank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Recursively freezes detached API output. */
function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
    return Object.freeze(value);
  }
  return value;
}

/** Sorts JSON object keys without changing array order. */
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortValue(item));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}
