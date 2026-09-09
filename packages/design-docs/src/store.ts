import { createHash } from 'node:crypto';
import { dirname, basename } from 'node:path';
import {
  DEFAULT_STORE_LIMITS,
  applyCanonicalBatch,
  recoverCanonicalTransactions,
  resolveManagedPath,
  resolveManagedRoot,
  withRepositoryLease,
  type ByteRevision,
  type CanonicalOperation,
  type ManagedRoot,
  type OperationControl,
  type RepositoryLease,
  type StoreLimits,
} from '@neottia/repository-store';
import {
  catalogFromEntities,
  discoverCatalog,
  documentStoragePath,
  entityRecord,
  entitySummary,
  type CatalogEntity,
  type DocumentCatalog,
} from './catalog.js';
import { decodeDocument, decodeHarnessctlDocument, encodeCanonicalDocument, type DocumentRevision } from './codec.js';
import type { DesignDocsConfig } from './config.js';
import { asDesignDocsError, DesignDocsError } from './errors.js';
import { assertDocumentId, createDocumentId } from './identities.js';
import { ensureDesignDocsCache, searchDesignDocsCache, type SearchDocumentsInput } from './index-sqlite.js';
import type {
  CanonicalDocumentMetadata,
  DocumentKind,
  DocumentLocation,
  DocumentOperationReport,
  DocumentRecord,
  DocumentSearchHit,
  DocumentStatus,
  DocumentSummary,
  DocumentValidationReport,
  TransitionEvidence,
} from './schemas.js';
import {
  documentArchiveInputSchema,
  documentCreateInputSchema,
  documentGetInputSchema,
  documentImportInputSchema,
  documentListInputSchema,
  documentSearchInputSchema,
  documentTransitionInputSchema,
  documentUpdateInputSchema,
  documentValidateInputSchema,
  documentVersionInputSchema,
} from './tool-contracts.js';

export interface CreateDocumentInput {
  readonly title: string;
  readonly kind: DocumentKind;
  readonly created_by?: string;
  readonly body?: string;
  readonly metadata?: Record<string, unknown>;
}
export interface UpdateDocumentInput {
  readonly expected_revision: string;
  readonly title?: string;
  readonly kind?: DocumentKind;
  readonly body?: string;
  readonly metadata?: Record<string, unknown> | null;
}
export interface TransitionDocumentInput {
  readonly expected_revision: string;
  readonly to: DocumentStatus;
  readonly intent: string;
  readonly actor: string;
  readonly evidence: TransitionEvidence;
}
export interface VersionDocumentInput {
  readonly expected_revision: string;
  readonly title?: string;
  readonly kind?: DocumentKind;
  readonly body?: string;
  readonly metadata?: Record<string, unknown> | null;
}
export interface ListDocumentsInput {
  readonly kind?: DocumentKind;
  readonly status?: DocumentStatus;
  readonly location?: DocumentLocation;
  readonly id?: string;
  readonly current_only?: boolean;
  readonly limit?: number;
}
export interface DocumentAddress {
  readonly id: string;
  readonly version?: number;
}
export type DocumentAddressResult =
  | {
      readonly status: 'found';
      readonly id: string;
      readonly version: number;
      readonly location: DocumentLocation;
      readonly revision: DocumentRevision;
    }
  | {
      readonly status: 'not_found';
      readonly id: string;
      readonly version?: number;
      readonly reason: 'id_not_found' | 'version_not_found';
    };
export type DocumentAddressBatch =
  | { readonly status: 'ok'; readonly results: readonly DocumentAddressResult[] }
  | { readonly status: 'invalid'; readonly findings: DocumentValidationReport['findings'] }
  | { readonly status: 'disabled' };
export interface ImportDocumentsInput {
  readonly content: string;
  readonly preview?: boolean;
  readonly format?: 'native' | 'harnessctl-v2';
}
export interface ImportPathMapping {
  readonly legacy_path: string;
  readonly id: string;
  readonly version: number;
  readonly neottia_path: string;
}
export interface ImportDocumentsReport {
  readonly preview: boolean;
  readonly valid: boolean;
  readonly additions: number;
  readonly conflicts: string[];
  readonly unsupported: string[];
  readonly warnings: string[];
  readonly path_mappings: ImportPathMapping[];
}
export interface CrossDomainValidationSnapshot {
  /** Existing live authority lease; validators must not reacquire it. */
  readonly lease: RepositoryLease;
  readonly documents: readonly DocumentSummary[];
  resolveAddresses(addresses: readonly DocumentAddress[]): Promise<DocumentAddressBatch>;
}
export type DesignDocLinkValidator = (
  snapshot: CrossDomainValidationSnapshot,
  control?: OperationControl,
) => Promise<readonly DocumentValidationReport['findings'][number][]>;
export interface DesignDocumentStoreOptions {
  readonly clock?: () => Date;
  readonly generateId?: (timestamp: number) => string;
  readonly onStaleCache?: () => boolean | Promise<boolean>;
  /** Optional cycle-free composition callback; core never imports Issues. */
  readonly linkValidator?: DesignDocLinkValidator;
}

/** Repository-local Design Docs authority with exact revisions and durable batches. */
export class DesignDocumentStore {
  private constructor(
    private readonly config: DesignDocsConfig,
    private readonly docsRoot: ManagedRoot,
    private readonly cacheRoot: ManagedRoot,
    private readonly folder: string,
    private readonly options: DesignDocumentStoreOptions,
  ) {}

  /** Checks disabled state before resolveManagedRoot can create any directory. */
  public static async fromConfig(
    config: DesignDocsConfig,
    cwd: string,
    options: DesignDocumentStoreOptions = {},
  ): Promise<DesignDocumentStore> {
    if (!config.enabled)
      throw new DesignDocsError('disabled', 'CAPABILITY_DISABLED', 'Design Docs capability is disabled.');
    const parent = dirname(config.root).replaceAll('\\', '/');
    const docsRoot = await resolveManagedRoot({
      authorityRoot: cwd,
      ...(parent === '.' ? {} : { managedPath: parent }),
      limits: storeLimits(config),
    });
    const cacheRoot = await resolveManagedRoot({
      authorityRoot: cwd,
      managedPath: '.neottia/cache',
      limits: storeLimits(config),
    });
    return new DesignDocumentStore(config, docsRoot, cacheRoot, basename(config.root), options);
  }

  public async id(control: OperationControl = {}): Promise<{ id: string }> {
    return this.locked(async (catalog) => {
      for (let attempts = 0; attempts < 100; attempts++) {
        const id = this.options.generateId?.(this.now().getTime()) ?? createDocumentId(this.now().getTime());
        if (!catalog.byId.has(id)) return { id };
      }
      throw new DesignDocsError('identity_ambiguity', 'ID_COLLISION', 'Could not allocate a unique document ID.');
    }, control);
  }

  public async create(input: CreateDocumentInput, control: OperationControl = {}): Promise<DocumentRecord> {
    input = parseDomainInput(documentCreateInputSchema, input, 'create');
    return this.locked(async (catalog, lease) => {
      const now = timestamp(this.now());
      let id = '';
      for (let attempts = 0; attempts < 100; attempts++) {
        id = this.options.generateId?.(Date.parse(now)) ?? createDocumentId(Date.parse(now));
        if (!catalog.byId.has(id)) break;
      }
      if (!id || catalog.byId.has(id))
        throw new DesignDocsError('identity_ambiguity', 'ID_COLLISION', 'Could not allocate a unique document ID.');
      const metadata: CanonicalDocumentMetadata = {
        id,
        title: input.title,
        kind: input.kind,
        status: 'draft',
        version: 1,
        created_at: now,
        updated_at: now,
        ...(input.created_by === undefined ? {} : { created_by: input.created_by }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      };
      const bytes = encodeCanonicalDocument(metadata, input.body ?? '', this.config.security.limits);
      const entity = this.newEntity(metadata, bytes, 'active');
      const proposed = catalogFromEntities([...catalog.entities, entity], this.config);
      await this.publish(lease, [{ kind: 'write', path: entity.managedPath, bytes, expected: 'absent' }], control);
      return entityRecord(entity, proposed.byId.get(id) ?? []);
    }, control);
  }

  public async list(input: ListDocumentsInput = {}, control: OperationControl = {}): Promise<DocumentSummary[]> {
    input = parseDomainInput(documentListInputSchema, input, 'list');
    return this.locked(async (catalog) => {
      const limit = Math.min(
        input.limit ?? this.config.security.limits.max_results,
        this.config.security.limits.max_results,
      );
      return catalog.entities
        .filter((entity) => !input.id || entity.decoded.metadata.id === input.id)
        .filter((entity) => !input.kind || entity.decoded.metadata.kind === input.kind)
        .filter((entity) => !input.status || entity.decoded.metadata.status === input.status)
        .filter((entity) => !input.location || entity.location === input.location)
        .filter((entity) => !input.current_only || catalog.byId.get(entity.decoded.metadata.id)?.at(-1) === entity)
        .map((entity) => entitySummary(entity, catalog.byId.get(entity.decoded.metadata.id) ?? []))
        .slice(0, limit);
    }, control);
  }

  public async search(input: SearchDocumentsInput, control: OperationControl = {}): Promise<DocumentSearchHit[]> {
    input = parseDomainInput(documentSearchInputSchema, input, 'search');
    return this.locked(async (catalog, lease) => {
      const { cache } = await ensureDesignDocsCache(
        this.cacheRoot,
        lease,
        catalog,
        this.config,
        this.options.onStaleCache,
        control,
      );
      try {
        return await searchDesignDocsCache(cache.database, catalog, input, this.config);
      } finally {
        await cache.close();
      }
    }, control);
  }

  public async get(id: string, version?: number, control: OperationControl = {}): Promise<DocumentRecord> {
    ({ id, version } = parseDomainInput(documentGetInputSchema, { id, version }, 'get'));
    return this.locked(async (catalog) => {
      assertDocumentId(id);
      const lineage = catalog.byId.get(id);
      if (!lineage?.length) throw new DesignDocsError('schema', 'DOCUMENT_NOT_FOUND', `Document was not found: ${id}`);
      const entity =
        version === undefined ? lineage.at(-1) : lineage.find((item) => item.decoded.metadata.version === version);
      if (!entity)
        throw new DesignDocsError('schema', 'VERSION_NOT_FOUND', `Document version was not found: ${id} v${version}`);
      return entityRecord(entity, lineage);
    }, control);
  }

  public async update(id: string, input: UpdateDocumentInput, control: OperationControl = {}): Promise<DocumentRecord> {
    const parsed = parseDomainInput(documentUpdateInputSchema, { id, ...input }, 'update');
    const { id: parsedId, ...changes } = parsed;
    return this.replaceCurrent(parsedId, changes.expected_revision, false, changes, control);
  }

  public async transition(
    id: string,
    input: TransitionDocumentInput,
    control: OperationControl = {},
  ): Promise<DocumentRecord> {
    const parsed = parseDomainInput(documentTransitionInputSchema, { id, ...input }, 'transition');
    id = parsed.id;
    input = parsed;
    return this.locked(async (catalog, lease) => {
      const current = requireCurrent(catalog, id, input.expected_revision, 'active');
      const from = current.decoded.metadata.status;
      const allowed =
        (from === 'draft' && input.to === 'review') ||
        (from === 'review' && (input.to === 'draft' || input.to === 'approved'));
      if (!allowed)
        throw new DesignDocsError(
          'lifecycle',
          'TRANSITION_INVALID',
          `Status transition is not allowed: ${from} -> ${input.to}`,
        );
      if (!input.intent.trim() || !input.actor.trim())
        throw new DesignDocsError(
          'schema',
          'TRANSITION_EVIDENCE_REQUIRED',
          'Transition intent and actor are required.',
        );
      const metadata: CanonicalDocumentMetadata = {
        ...current.decoded.metadata,
        status: input.to,
        updated_at: timestamp(this.now()),
        metadata: {
          ...(current.decoded.metadata.metadata ?? {}),
          _neottia_transition: { intent: input.intent, actor: input.actor, evidence: input.evidence },
        },
      };
      return this.replaceEntity(catalog, lease, current, metadata, current.decoded.content, control);
    }, control);
  }

  public async version(
    id: string,
    input: VersionDocumentInput,
    control: OperationControl = {},
  ): Promise<DocumentRecord> {
    const parsed = parseDomainInput(documentVersionInputSchema, { id, ...input }, 'version');
    id = parsed.id;
    input = parsed;
    return this.locked(async (catalog, lease) => {
      const current = requireCurrent(catalog, id, input.expected_revision, 'active');
      if (current.decoded.metadata.status !== 'approved')
        throw new DesignDocsError(
          'lifecycle',
          'VERSION_REQUIRES_APPROVED',
          'A semantic successor requires the latest approved version.',
        );
      const metadata: CanonicalDocumentMetadata = {
        ...current.decoded.metadata,
        title: input.title ?? current.decoded.metadata.title,
        kind: input.kind ?? current.decoded.metadata.kind,
        status: 'draft',
        version: current.decoded.metadata.version + 1,
        updated_at: timestamp(this.now()),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata ?? undefined }),
      };
      const bytes = encodeCanonicalDocument(
        metadata,
        input.body ?? current.decoded.content,
        this.config.security.limits,
      );
      const entity = this.newEntity(metadata, bytes, 'active');
      const proposed = catalogFromEntities([...catalog.entities, entity], this.config);
      await this.publish(lease, [{ kind: 'write', path: entity.managedPath, bytes, expected: 'absent' }], control);
      return entityRecord(entity, proposed.byId.get(id) ?? []);
    }, control);
  }

  public async validate(
    id?: string,
    control: OperationControl = {},
    options: { readonly crossDomain?: boolean } = {},
  ): Promise<DocumentValidationReport> {
    const parsedInput = parseDomainInput(
      documentValidateInputSchema,
      { id, cross_domain: options.crossDomain },
      'validate',
    );
    id = parsedInput.id;
    try {
      return await this.locked(async (catalog, lease) => {
        if (id && !catalog.byId.has(id))
          throw new DesignDocsError('schema', 'DOCUMENT_NOT_FOUND', `Document was not found: ${id}`);
        const cached = await ensureDesignDocsCache(
          this.cacheRoot,
          lease,
          catalog,
          this.config,
          this.options.onStaleCache,
          control,
        );
        await cached.cache.close();
        const findings = parsedInput.cross_domain ? await this.validateCrossDomain(catalog, lease, control) : [];
        return {
          valid: findings.length === 0,
          documents: catalog.entities.length,
          lineages: catalog.byId.size,
          findings,
          cache: cached.rebuilt ? 'rebuilt' : 'checked',
        };
      }, control);
    } catch (error: unknown) {
      const value = asDesignDocsError(error);
      return {
        valid: false,
        documents: 0,
        lineages: 0,
        findings: [
          { ...(id ? { document: id } : {}), category: value.category, code: value.code, message: value.message },
        ],
        cache: 'skipped',
      };
    }
  }

  public async archive(
    id: string,
    expectedRevision: string,
    control: OperationControl = {},
  ): Promise<DocumentOperationReport> {
    const parsed = parseDomainInput(documentArchiveInputSchema, { id, expected_revision: expectedRevision }, 'archive');
    return this.moveLineage(parsed.id, parsed.expected_revision, 'archive', control);
  }
  public async restore(
    id: string,
    expectedRevision: string,
    control: OperationControl = {},
  ): Promise<DocumentOperationReport> {
    const parsed = parseDomainInput(documentArchiveInputSchema, { id, expected_revision: expectedRevision }, 'restore');
    return this.moveLineage(parsed.id, parsed.expected_revision, 'active', control);
  }

  public async export(control: OperationControl = {}): Promise<string> {
    return this.locked(async (catalog) => {
      const documents = catalog.entities.map((entity) => ({
        location: entity.location,
        source_base64: Buffer.from(entity.decoded.bytes).toString('base64'),
      }));
      const unsigned = { version: 1, format: 'neottia-design-docs', documents } as const;
      const digest = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
      const content = `${JSON.stringify({ ...unsigned, digest })}\n`;
      if (Buffer.byteLength(content) > this.config.security.limits.max_import_bytes)
        throw new DesignDocsError('resource_limit', 'EXPORT_LIMIT', 'Export exceeds configured byte limit.');
      return content;
    }, control);
  }

  public async import(input: ImportDocumentsInput, control: OperationControl = {}): Promise<ImportDocumentsReport> {
    input = parseDomainInput(documentImportInputSchema, input, 'import');
    if (Buffer.byteLength(input.content) > this.config.security.limits.max_import_bytes)
      throw new DesignDocsError('resource_limit', 'IMPORT_LIMIT', 'Import exceeds configured byte limit.');
    return this.locked(async (catalog, lease) => {
      const conflicts: string[] = [];
      const unsupported: string[] = [];
      const warnings: string[] = [];
      const path_mappings: ImportPathMapping[] = [];
      let value: unknown;
      try {
        value = JSON.parse(input.content);
      } catch {
        throw new DesignDocsError(
          'parse_safety',
          'IMPORT_JSON_INVALID',
          'Import content must be a Design Docs migration bundle.',
        );
      }
      const additions: CatalogEntity[] = [];
      if (input.format === 'harnessctl-v2') {
        if (!isHarnessctlBundle(value))
          throw new DesignDocsError(
            'schema',
            'IMPORT_SCHEMA_INVALID',
            'Harnessctl import requires an explicit harnessctl-v2-design-documents bundle.',
          );
        warnings.push('Harnessctl records were supplied explicitly; no legacy directory was scanned or mutated.');
        for (const item of value.documents) {
          try {
            const decoded = decodeHarnessctlDocument(item.content, this.config.security.limits);
            const existing = catalog.byId
              .get(decoded.metadata.id)
              ?.find((entity) => entity.decoded.metadata.version === decoded.metadata.version);
            if (existing) {
              conflicts.push(`${decoded.metadata.id}:v${decoded.metadata.version}`);
              continue;
            }
            const location =
              item.location ?? (item.path.startsWith('.harnessctl/documents/archive/') ? 'archive' : 'active');
            const entity = this.newEntity(decoded.metadata, decoded.bytes, location);
            additions.push(entity);
            path_mappings.push({
              legacy_path: item.path,
              id: decoded.metadata.id,
              version: decoded.metadata.version,
              neottia_path: entity.publicPath,
            });
          } catch (error: unknown) {
            unsupported.push(`${item.path}: ${asDesignDocsError(error).message}`);
          }
        }
      } else {
        if (!isImportBundle(value))
          throw new DesignDocsError(
            'schema',
            'IMPORT_SCHEMA_INVALID',
            'Native import bundle has an unsupported schema.',
          );
        const { digest, ...unsigned } = value;
        if (createHash('sha256').update(JSON.stringify(unsigned)).digest('hex') !== digest)
          throw new DesignDocsError(
            'parse_safety',
            'IMPORT_DIGEST_INVALID',
            'Import bundle digest does not match its content.',
          );
        for (const item of value.documents) {
          try {
            const decoded = decodeDocument(Buffer.from(item.source_base64, 'base64'), this.config.security.limits);
            const existing = catalog.byId
              .get(decoded.metadata.id)
              ?.find((entity) => entity.decoded.metadata.version === decoded.metadata.version);
            if (existing) {
              conflicts.push(`${decoded.metadata.id}:v${decoded.metadata.version}`);
              continue;
            }
            additions.push(this.newEntity(decoded.metadata, decoded.bytes, item.location));
          } catch (error: unknown) {
            unsupported.push(asDesignDocsError(error).message);
          }
        }
      }
      let proposed: DocumentCatalog | undefined;
      try {
        proposed = catalogFromEntities([...catalog.entities, ...additions], this.config);
      } catch (error: unknown) {
        unsupported.push(asDesignDocsError(error).message);
      }
      const report = {
        preview: input.preview ?? true,
        valid: conflicts.length === 0 && unsupported.length === 0,
        additions: additions.length,
        conflicts,
        unsupported,
        warnings,
        path_mappings,
      };
      if (report.preview || !report.valid || !proposed) return report;
      const operations: CanonicalOperation[] = additions.map((entity) => ({
        kind: 'write',
        path: entity.managedPath,
        bytes: entity.decoded.bytes,
        expected: 'absent',
      }));
      await this.publish(lease, operations, control);
      return report;
    }, control);
  }

  /** Canonical under-lease lookup seam used by a separate Issues composition root. */
  public async resolveAddressesUnderLease(
    addresses: readonly DocumentAddress[],
    lease: RepositoryLease,
    control: OperationControl = {},
  ): Promise<DocumentAddressBatch> {
    if (!this.config.enabled) return { status: 'disabled' };
    if (addresses.length > this.config.security.limits.max_results)
      throw new DesignDocsError(
        'resource_limit',
        'ADDRESS_RESULT_LIMIT',
        'Address lookup exceeds configured result limits.',
      );
    for (const address of addresses) {
      assertDocumentId(address.id);
      if (address.version !== undefined && (!Number.isSafeInteger(address.version) || address.version < 1))
        throw new DesignDocsError(
          'schema',
          'ADDRESS_VERSION_INVALID',
          'Document address version must be a positive safe integer.',
        );
    }
    try {
      await recoverCanonicalTransactions(this.docsRoot, lease, control);
      const catalog = await discoverCatalog(this.docsRoot, this.folder, this.config, lease, control);
      return {
        status: 'ok',
        results: addresses.map((address) => {
          assertDocumentId(address.id);
          const lineage = catalog.byId.get(address.id);
          if (!lineage?.length)
            return {
              status: 'not_found',
              id: address.id,
              ...(address.version === undefined ? {} : { version: address.version }),
              reason: 'id_not_found',
            } as const;
          const entity =
            address.version === undefined
              ? lineage.at(-1)
              : lineage.find((candidate) => candidate.decoded.metadata.version === address.version);
          if (!entity)
            return {
              status: 'not_found',
              id: address.id,
              version: address.version,
              reason: 'version_not_found',
            } as const;
          return {
            status: 'found',
            id: address.id,
            version: entity.decoded.metadata.version,
            location: entity.location,
            revision: entity.decoded.revision,
          } as const;
        }),
      };
    } catch (error: unknown) {
      const value = asDesignDocsError(error);
      if (value.code === 'AUTHORITY_MISMATCH') throw value;
      return { status: 'invalid', findings: [{ category: value.category, code: value.code, message: value.message }] };
    }
  }

  private async validateCrossDomain(
    catalog: DocumentCatalog,
    lease: RepositoryLease,
    control: OperationControl,
  ): Promise<DocumentValidationReport['findings']> {
    if (!this.options.linkValidator)
      return [
        {
          category: 'synchronization',
          code: 'LINK_VALIDATOR_UNAVAILABLE',
          message: 'Cross-domain validation was requested but no issue-link validator is configured.',
        },
      ];
    const documents = catalog.entities.map((entity) =>
      entitySummary(entity, catalog.byId.get(entity.decoded.metadata.id) ?? []),
    );
    const findings = await this.options.linkValidator(
      {
        lease,
        documents,
        resolveAddresses: async (addresses) => ({
          status: 'ok',
          results: addresses.map((address) => {
            const lineage = catalog.byId.get(address.id);
            if (!lineage?.length)
              return {
                status: 'not_found',
                id: address.id,
                ...(address.version === undefined ? {} : { version: address.version }),
                reason: 'id_not_found',
              } as const;
            const entity =
              address.version === undefined
                ? lineage.at(-1)
                : lineage.find((candidate) => candidate.decoded.metadata.version === address.version);
            return entity
              ? ({
                  status: 'found',
                  id: address.id,
                  version: entity.decoded.metadata.version,
                  location: entity.location,
                  revision: entity.decoded.revision,
                } as const)
              : ({
                  status: 'not_found',
                  id: address.id,
                  version: address.version,
                  reason: 'version_not_found',
                } as const);
          }),
        }),
      },
      control,
    );
    if (
      findings.length > this.config.security.limits.max_results ||
      Buffer.byteLength(JSON.stringify(findings), 'utf8') > this.config.security.limits.max_result_bytes
    )
      throw new DesignDocsError(
        'resource_limit',
        'LINK_FINDING_LIMIT',
        'Cross-domain validation findings exceed configured limits.',
      );
    return [...findings];
  }

  private async replaceCurrent(
    id: string,
    expected: string,
    newVersion: boolean,
    input: UpdateDocumentInput,
    control: OperationControl,
  ): Promise<DocumentRecord> {
    void newVersion;
    return this.locked(async (catalog, lease) => {
      const current = requireCurrent(catalog, id, expected, 'active');
      if (current.decoded.metadata.status === 'approved')
        throw new DesignDocsError('lifecycle', 'APPROVED_IMMUTABLE', 'Approved document versions are immutable.');
      const metadata: CanonicalDocumentMetadata = {
        ...current.decoded.metadata,
        title: input.title ?? current.decoded.metadata.title,
        kind: input.kind ?? current.decoded.metadata.kind,
        updated_at: timestamp(this.now()),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata ?? undefined }),
      };
      return this.replaceEntity(catalog, lease, current, metadata, input.body ?? current.decoded.content, control);
    }, control);
  }

  private async replaceEntity(
    catalog: DocumentCatalog,
    lease: RepositoryLease,
    current: CatalogEntity,
    metadata: CanonicalDocumentMetadata,
    content: string,
    control: OperationControl,
  ): Promise<DocumentRecord> {
    const bytes = encodeCanonicalDocument(metadata, content, this.config.security.limits);
    const next = this.newEntity(metadata, bytes, current.location);
    const remaining = catalog.entities.filter((entity) => entity !== current);
    const proposed = catalogFromEntities([...remaining, next], this.config);
    const operations: CanonicalOperation[] =
      next.storagePath === current.storagePath
        ? [
            {
              kind: 'write',
              path: current.managedPath,
              bytes,
              expected: toRepositoryRevision(current.decoded.revision),
            },
          ]
        : [
            { kind: 'write', path: next.managedPath, bytes, expected: 'absent' },
            { kind: 'remove', path: current.managedPath, expected: toRepositoryRevision(current.decoded.revision) },
          ];
    await this.publish(lease, operations, control);
    return entityRecord(next, proposed.byId.get(metadata.id) ?? []);
  }

  private async moveLineage(
    id: string,
    expected: string,
    destination: DocumentLocation,
    control: OperationControl,
  ): Promise<DocumentOperationReport> {
    return this.locked(async (catalog, lease) => {
      const source: DocumentLocation = destination === 'archive' ? 'active' : 'archive';
      const current = requireCurrent(catalog, id, expected, source);
      const lineage = catalog.byId.get(id) as readonly CatalogEntity[];
      const moved = lineage.map((entity) => this.newEntity(entity.decoded.metadata, entity.decoded.bytes, destination));
      const proposed = catalogFromEntities(
        [...catalog.entities.filter((entity) => !lineage.includes(entity)), ...moved],
        this.config,
      );
      const operations: CanonicalOperation[] = lineage.map((entity, index) => ({
        kind: 'move',
        from: entity.managedPath,
        to: (moved[index] as CatalogEntity).managedPath,
        expectedSource: toRepositoryRevision(entity.decoded.revision),
        expectedDestination: 'absent',
      }));
      await this.publish(lease, operations, control);
      return {
        id: current.decoded.metadata.id,
        location: destination,
        documents: (proposed.byId.get(id) ?? []).map((entity) => entitySummary(entity, proposed.byId.get(id) ?? [])),
      };
    }, control);
  }

  private newEntity(metadata: CanonicalDocumentMetadata, bytes: Uint8Array, location: DocumentLocation): CatalogEntity {
    const decoded = decodeDocument(bytes, this.config.security.limits);
    const storagePath = documentStoragePath(this.folder, location, metadata);
    const suffix = storagePath.slice(this.folder.length + 1);
    return {
      decoded,
      storagePath,
      publicPath: `${this.config.root}/${suffix}`,
      managedPath: resolveManagedPath(this.docsRoot, storagePath),
      location,
    };
  }

  private async publish(
    lease: RepositoryLease,
    operations: readonly CanonicalOperation[],
    control: OperationControl,
  ): Promise<void> {
    await applyCanonicalBatch(this.docsRoot, lease, operations, {
      ...control,
      inventory: [resolveManagedPath(this.docsRoot, this.folder)],
    });
  }

  private async locked<T>(
    operation: (catalog: DocumentCatalog, lease: RepositoryLease) => Promise<T>,
    control: OperationControl,
  ): Promise<T> {
    try {
      return await withRepositoryLease(
        this.docsRoot,
        async (lease) =>
          operation(await discoverCatalog(this.docsRoot, this.folder, this.config, lease, control), lease),
        control,
      );
    } catch (error: unknown) {
      throw asDesignDocsError(error);
    }
  }
  private now(): Date {
    return this.options.clock?.() ?? new Date();
  }
}

function requireCurrent(
  catalog: DocumentCatalog,
  id: string,
  expected: string,
  location: DocumentLocation,
): CatalogEntity {
  assertDocumentId(id);
  if (!expected) throw new DesignDocsError('stale_revision', 'REVISION_REQUIRED', 'Expected revision is required.');
  const lineage = catalog.byId.get(id);
  if (!lineage?.length || lineage.some((entity) => entity.location !== location))
    throw new DesignDocsError('schema', 'DOCUMENT_NOT_FOUND', `${location} document was not found: ${id}`);
  const current = lineage.at(-1) as CatalogEntity;
  if (current.decoded.revision !== expected)
    throw new DesignDocsError(
      'stale_revision',
      'REVISION_MISMATCH',
      `Document changed since the expected revision was calculated: ${id}`,
    );
  return current;
}
function toRepositoryRevision(revision: DocumentRevision): ByteRevision {
  return `sha256:${revision.slice('v1:'.length)}`;
}
function timestamp(date: Date): string {
  if (Number.isNaN(date.getTime()))
    throw new DesignDocsError('schema', 'TIMESTAMP_INVALID', 'Clock returned an invalid date.');
  return date.toISOString();
}
function storeLimits(config: DesignDocsConfig): StoreLimits {
  const limits = config.security.limits;
  return {
    ...DEFAULT_STORE_LIMITS,
    maxFileBytes: limits.max_file_bytes,
    maxFiles: limits.max_files,
    maxTotalBytes: limits.max_aggregate_bytes,
    maxBatchPaths: Math.max(2, limits.max_files),
    maxBeforeImageBytes: limits.max_backup_bytes,
    maxJournalBytes: limits.max_journal_bytes,
    maxTemporaryBytes: limits.max_aggregate_bytes,
    maxQueryRows: limits.max_results,
    maxQueryResultBytes: limits.max_result_bytes,
  };
}
function parseDomainInput<Output>(
  schema: {
    safeParse(
      value: unknown,
    ):
      | { success: true; data: Output }
      | { success: false; error: { issues: readonly { path: PropertyKey[]; message: string }[] } };
  },
  value: unknown,
  operation: string,
): Output {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new DesignDocsError(
      'schema',
      'DOMAIN_INPUT_INVALID',
      `Invalid ${operation} input: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')}`,
    );
  return parsed.data;
}
function isHarnessctlBundle(value: unknown): value is {
  version: 1;
  format: 'harnessctl-v2-design-documents';
  documents: Array<{ path: string; content: string; location?: DocumentLocation }>;
} {
  if (
    value === null ||
    typeof value !== 'object' ||
    (value as Record<string, unknown>)['version'] !== 1 ||
    (value as Record<string, unknown>)['format'] !== 'harnessctl-v2-design-documents' ||
    !Array.isArray((value as Record<string, unknown>)['documents'])
  )
    return false;
  return ((value as Record<string, unknown>)['documents'] as unknown[]).every((item) => {
    if (item === null || typeof item !== 'object') return false;
    const record = item as Record<string, unknown>;
    return (
      typeof record['path'] === 'string' &&
      /^\.harnessctl\/documents\/(?:archive\/)?[^/]+\.md$/u.test(record['path']) &&
      typeof record['content'] === 'string' &&
      (record['location'] === undefined || record['location'] === 'active' || record['location'] === 'archive')
    );
  });
}
function isImportBundle(value: unknown): value is {
  version: 1;
  format: 'neottia-design-docs';
  documents: Array<{ location: DocumentLocation; source_base64: string }>;
  digest: string;
} {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as Record<string, unknown>)['version'] === 1 &&
    (value as Record<string, unknown>)['format'] === 'neottia-design-docs' &&
    typeof (value as Record<string, unknown>)['digest'] === 'string' &&
    Array.isArray((value as Record<string, unknown>)['documents']) &&
    ((value as Record<string, unknown>)['documents'] as unknown[]).every(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        ['active', 'archive'].includes(String((item as Record<string, unknown>)['location'])) &&
        typeof (item as Record<string, unknown>)['source_base64'] === 'string',
    )
  );
}
