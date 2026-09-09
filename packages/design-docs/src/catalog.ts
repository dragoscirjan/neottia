import {
  resolveManagedPath,
  scanManagedFiles,
  type ManagedPath,
  type ManagedRoot,
  type OperationControl,
  type RepositoryLease,
} from '@neottia/repository-store';
import { canonicalDocumentFilename, decodeDocument, type DecodedDocument } from './codec.js';
import type { DesignDocsConfig } from './config.js';
import { DesignDocsError } from './errors.js';
import { assertDocumentId } from './identities.js';
import type { DocumentLocation, DocumentRecord, DocumentSummary } from './schemas.js';

export interface CatalogEntity {
  readonly decoded: DecodedDocument;
  readonly storagePath: string;
  readonly publicPath: string;
  readonly managedPath: ManagedPath;
  readonly location: DocumentLocation;
}
export interface DocumentCatalog {
  readonly entities: readonly CatalogEntity[];
  readonly byId: ReadonlyMap<string, readonly CatalogEntity[]>;
}

/** Reads and validates the complete active+archive canonical snapshot. */
export async function discoverCatalog(
  root: ManagedRoot,
  folder: string,
  config: DesignDocsConfig,
  lease: RepositoryLease,
  control: OperationControl = {},
): Promise<DocumentCatalog> {
  const start = resolveManagedPath(root, folder);
  const files = await scanManagedFiles(root, lease, { under: [start], ...control });
  const entities: CatalogEntity[] = [];
  for (const file of files) {
    const suffix = relativeUnder(file.path.relativePath, folder);
    const parts = suffix.split('/');
    const location: DocumentLocation =
      parts.length === 1
        ? 'active'
        : parts.length === 2 && parts[0] === 'archive'
          ? 'archive'
          : invalidPath(file.path.relativePath);
    const filename = parts.at(-1) as string;
    if (!filename.endsWith('.md'))
      throw new DesignDocsError(
        'path_safety',
        'STORAGE_ENTRY_UNSUPPORTED',
        'Only canonical Markdown files are allowed in Design Docs storage.',
        [file.path.relativePath],
      );
    const decoded = decodeDocument(file.bytes, config.security.limits);
    assertDocumentId(decoded.metadata.id);
    if (canonicalDocumentFilename(decoded.metadata) !== filename)
      throw new DesignDocsError(
        'canonical_form',
        'FILENAME_INVALID',
        'Document filename does not match canonical metadata.',
        [file.path.relativePath],
      );
    entities.push({
      decoded,
      storagePath: file.path.relativePath,
      publicPath: `${config.root}/${suffix}`,
      managedPath: file.path,
      location,
    });
  }
  return catalogFromEntities(entities, config);
}

/** Validates complete proposed entities before any canonical publication. */
export function catalogFromEntities(
  entitiesInput: readonly CatalogEntity[],
  config: DesignDocsConfig,
): DocumentCatalog {
  const entities = [...entitiesInput].sort(compareEntity);
  const limits = config.security.limits;
  if (entities.length > limits.max_files)
    throw new DesignDocsError('resource_limit', 'FILE_COUNT_LIMIT', 'Document file count limit exceeded.');
  const aggregate = entities.reduce((total, entity) => total + entity.decoded.bytes.byteLength, 0);
  if (aggregate > limits.max_aggregate_bytes)
    throw new DesignDocsError('resource_limit', 'AGGREGATE_LIMIT', 'Aggregate canonical document byte limit exceeded.');
  const paths = new Set<string>();
  const versions = new Set<string>();
  const byId = new Map<string, CatalogEntity[]>();
  for (const entity of entities) {
    const pathKey = portable(entity.storagePath);
    if (paths.has(pathKey))
      throw new DesignDocsError(
        'identity_ambiguity',
        'PATH_COLLISION',
        'Document paths collide under portable comparison.',
        [entity.publicPath],
      );
    paths.add(pathKey);
    const versionKey = `${portable(entity.decoded.metadata.id)}\0${entity.decoded.metadata.version}`;
    if (versions.has(versionKey))
      throw new DesignDocsError(
        'identity_ambiguity',
        'VERSION_DUPLICATE',
        `Duplicate document version: ${entity.decoded.metadata.id} v${entity.decoded.metadata.version}`,
      );
    versions.add(versionKey);
    const lineage = byId.get(entity.decoded.metadata.id) ?? [];
    lineage.push(entity);
    byId.set(entity.decoded.metadata.id, lineage);
  }
  for (const [id, lineage] of byId) validateLineage(id, lineage, limits.max_versions);
  return { entities, byId };
}

export function documentStoragePath(
  folder: string,
  location: DocumentLocation,
  metadata: Parameters<typeof canonicalDocumentFilename>[0],
): string {
  const name = canonicalDocumentFilename(metadata);
  return location === 'active' ? `${folder}/${name}` : `${folder}/archive/${name}`;
}

export function entityRecord(entity: CatalogEntity, lineage: readonly CatalogEntity[]): DocumentRecord {
  const current = lineage.at(-1)?.decoded.metadata.version ?? entity.decoded.metadata.version;
  return {
    ...entitySummary(entity, lineage),
    metadata: structuredClone(entity.decoded.metadata),
    body: entity.decoded.body,
    superseded: entity.decoded.metadata.version < current,
  };
}
export function entitySummary(entity: CatalogEntity, lineage: readonly CatalogEntity[]): DocumentSummary {
  const metadata = entity.decoded.metadata;
  const current = lineage.at(-1)?.decoded.metadata.version ?? metadata.version;
  return {
    id: metadata.id,
    path: entity.publicPath,
    revision: entity.decoded.revision,
    location: entity.location,
    superseded: metadata.version < current,
    archived: entity.location === 'archive',
    title: metadata.title,
    kind: metadata.kind,
    status: metadata.status,
    version: metadata.version,
  };
}

function validateLineage(id: string, lineage: readonly CatalogEntity[], maxVersions: number): void {
  if (lineage.length > maxVersions)
    throw new DesignDocsError('resource_limit', 'VERSION_LIMIT', `Document lineage version limit exceeded: ${id}`);
  const sorted = [...lineage].sort((left, right) => left.decoded.metadata.version - right.decoded.metadata.version);
  if (new Set(sorted.map((item) => item.location)).size !== 1)
    throw new DesignDocsError(
      'identity_ambiguity',
      'LINEAGE_SPLIT',
      `Document lineage spans active and archive: ${id}`,
    );
  if (sorted.some((item, index) => item.decoded.metadata.version !== index + 1))
    throw new DesignDocsError('identity_ambiguity', 'LINEAGE_GAP', `Document lineage is not contiguous: ${id}`);
  const created = sorted[0]?.decoded.metadata.created_at;
  if (sorted.some((item) => item.decoded.metadata.created_at !== created))
    throw new DesignDocsError('schema', 'LINEAGE_CREATED_AT', `Document lineage created_at is inconsistent: ${id}`);
  // Historical approved bytes may only be followed by versions; a non-approved
  // predecessor would represent an unsupported semantic branch.
  if (sorted.slice(0, -1).some((item) => item.decoded.metadata.status !== 'approved'))
    throw new DesignDocsError(
      'lifecycle',
      'LINEAGE_PREDECESSOR_UNAPPROVED',
      `Only approved versions may have successors: ${id}`,
    );
}
function compareEntity(left: CatalogEntity, right: CatalogEntity): number {
  return (
    left.decoded.metadata.id.localeCompare(right.decoded.metadata.id) ||
    left.decoded.metadata.version - right.decoded.metadata.version
  );
}
function relativeUnder(value: string, folder: string): string {
  const prefix = `${folder}/`;
  if (!value.startsWith(prefix)) return invalidPath(value);
  return value.slice(prefix.length);
}
function invalidPath(path: string): never {
  throw new DesignDocsError('path_safety', 'STORAGE_LAYOUT_INVALID', 'Unexpected Design Docs storage path.', [path]);
}
function portable(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US');
}
