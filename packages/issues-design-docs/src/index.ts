import { resolve } from 'node:path';
import { createConfigRegistry, resolveConfig, type ResolvedConfigSnapshot } from '@neottia/config';
import {
  DesignDocsError,
  DesignDocumentStore,
  designDocsConfigContribution,
  type DesignDocsConfig,
  type DesignDocsConfigInput,
  type DesignDocLinkValidator,
  type DocumentAddress,
  type DocumentAddressResult,
} from '@neottia/design-docs';
import {
  inspectIssueCatalog,
  inspectIssueGraph,
  issueConfigContribution,
  type DesignDocumentReferenceResolver,
  type IssueConfig,
  type IssueConfigInput,
} from '@neottia/issues';
import { memoryConfigContribution } from '@neottia/memory-core';
import {
  DEFAULT_STORE_LIMITS,
  recoverCanonicalTransactions,
  resolveManagedRoot,
  type StoreLimits,
} from '@neottia/repository-store';

export interface HostConfigSnapshotOptions {
  readonly cwd: string;
  readonly interactive: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly overrides?: Readonly<Record<string, unknown>>;
  readonly snapshot?: ResolvedConfigSnapshot;
}

/** Resolves every hosted module once and derives non-interactive cache policy in memory. */
export function resolveHostConfigSnapshot(options: HostConfigSnapshotOptions): ResolvedConfigSnapshot {
  if (options.snapshot && (options.env || options.overrides))
    throw new TypeError('A supplied host snapshot cannot be combined with configuration source options.');
  const declared =
    options.snapshot ??
    resolveConfig(
      createConfigRegistry([memoryConfigContribution, issueConfigContribution, designDocsConfigContribution]),
      {
        cwd: resolve(options.cwd),
        env: options.env ?? process.env,
        ...(options.overrides ? { overrides: options.overrides } : {}),
      },
    );
  if (options.interactive) return declared;

  const modules: Record<string, unknown> = {};
  if (declared.get(memoryConfigContribution).cache.stale_policy === 'prompt')
    modules['memory'] = { cache: { stale_policy: 'rebuild' } };
  if (declared.get(issueConfigContribution).cache.stale_policy === 'prompt')
    modules['issues'] = { cache: { stale_policy: 'rebuild' } };
  if (declared.get(designDocsConfigContribution).cache.stale_policy === 'prompt')
    modules['design_docs'] = { cache: { stale_policy: 'rebuild' } };
  return Object.keys(modules).length === 0
    ? declared
    : declared.derive({ modules }, 'non-interactive host stale-cache policy');
}

export interface IssuesDesignDocsCompositionOptions {
  readonly cwd: string;
  /** A pre-resolved multi-module snapshot supplied by a shared host. */
  readonly snapshot?: ResolvedConfigSnapshot;
  /** Explicit environment used only when this package resolves the shared snapshot. */
  readonly env?: NodeJS.ProcessEnv;
  /** Standalone runtime overrides resolved into the same snapshot as Design Docs. */
  readonly issuesConfigOverrides?: Partial<IssueConfigInput>;
  /** Standalone runtime overrides resolved into the same snapshot as Issues. */
  readonly designDocsConfigOverrides?: Partial<DesignDocsConfigInput>;
}

export interface IssuesDesignDocsComposition {
  readonly resolver: DesignDocumentReferenceResolver;
  readonly linkValidator: DesignDocLinkValidator;
}

/** Composes both domains without introducing either domain as a dependency of the other. */
export function createIssuesDesignDocsComposition(
  options: IssuesDesignDocsCompositionOptions,
): IssuesDesignDocsComposition {
  const cwd = resolve(options.cwd);
  const { designDocsConfig, issuesConfig } = captureConfigs(options, cwd);
  const resolver: DesignDocumentReferenceResolver = {
    async resolveMany(references, context) {
      if (!designDocsConfig.enabled) return { status: 'target_disabled' };
      const store = await DesignDocumentStore.fromConfig(designDocsConfig, cwd);
      const config = designDocsConfig;
      const unique = new Map(references.map((reference) => [addressKey(reference), reference]));
      const resolvedByKey = new Map<string, DocumentAddressResult>();
      const distinct = [...unique.values()];
      for (let offset = 0; offset < distinct.length; offset += config.security.limits.max_results) {
        const addresses = distinct.slice(offset, offset + config.security.limits.max_results);
        const batch = await store.resolveAddressesUnderLease(addresses, context.lease, context);
        if (batch.status === 'disabled') return { status: 'target_disabled' };
        if (batch.status === 'invalid')
          return {
            status: 'target_invalid',
            findings: batch.findings.map((finding) => ({
              code: finding.code,
              message: finding.message,
              ...(finding.document === undefined ? {} : { id: finding.document }),
            })),
          };
        if (batch.results.length !== addresses.length)
          throw new Error('Design Docs returned an unexpected result cardinality.');
        addresses.forEach((address, index) => resolvedByKey.set(addressKey(address), batch.results[index]!));
      }
      return {
        status: 'ok',
        results: references.map((reference) => {
          const result = resolvedByKey.get(addressKey(reference));
          if (!result) throw new Error('Design Docs omitted an address result.');
          return result.status === 'found'
            ? {
                status: 'resolved' as const,
                reference,
                resolvedVersion: result.version,
                location: result.location,
                revision: result.revision,
              }
            : { status: 'unresolved' as const, reference, reason: result.reason };
        }),
      };
    },
  };

  const linkValidator: DesignDocLinkValidator = async (snapshot, control = {}) => {
    const config = issuesConfig;
    if (!config.enabled)
      return [
        {
          category: 'synchronization',
          code: 'ISSUES_DISABLED',
          message: 'Cross-domain validation requires the Issues capability to be enabled.',
        },
      ];
    const root = await resolveManagedRoot({ authorityRoot: cwd, limits: issueStoreLimits(config) });
    await recoverCanonicalTransactions(root, snapshot.lease, control);
    const inspected = await inspectIssueCatalog(root, snapshot.lease, config.root, config.prefix, control);
    const catalogFindings = inspected.findings.map((finding) => ({ source: 'CATALOG', finding }) as const);
    const graphFindings = inspectIssueGraph(inspected.catalog).map(
      (finding) => ({ source: 'GRAPH', finding }) as const,
    );
    const sourceFindings = [...catalogFindings, ...graphFindings];
    if (sourceFindings.length > 0)
      return boundedFindings(
        sourceFindings.map(({ source, finding }) => ({
          category: 'synchronization',
          code: `ISSUE_${source}_${finding.code}`,
          message: finding.message,
          ...(finding.path === undefined ? {} : { path: finding.path }),
        })),
        config,
      );

    const links = [...inspected.catalog.values()]
      .sort((left, right) =>
        left.relativePath === right.relativePath
          ? left.record.id.localeCompare(right.record.id)
          : left.relativePath.localeCompare(right.relativePath),
      )
      .flatMap((issue) =>
        [...issue.record.links]
          .sort((left, right) => addressKey(left).localeCompare(addressKey(right)))
          .map((link) => ({ issue, link })),
      );
    const addressesByKey = new Map<string, DocumentAddress>();
    for (const { link } of links)
      addressesByKey.set(addressKey(link), {
        id: link.id,
        ...(link.version === undefined ? {} : { version: link.version }),
      });
    const addresses = [...addressesByKey.values()];
    const resolved = await snapshot.resolveAddresses(addresses);
    if (resolved.status !== 'ok')
      return resolved.status === 'disabled'
        ? [
            {
              category: 'synchronization',
              code: 'DESIGN_DOCS_DISABLED',
              message: 'Design Docs became unavailable during cross-domain validation.',
            },
          ]
        : boundedFindings(resolved.findings, config);
    const results = new Map(addresses.map((address, index) => [addressKey(address), resolved.results[index]]));
    return boundedFindings(
      links.flatMap(({ issue, link }) => {
        const result = results.get(addressKey(link));
        if (result?.status !== 'not_found') return [];
        const pinned = link.version === undefined ? '' : ` version ${link.version}`;
        return [
          {
            document: link.id,
            path: issue.relativePath,
            category: 'synchronization',
            code: result.reason === 'id_not_found' ? 'ISSUE_LINK_ID_NOT_FOUND' : 'ISSUE_LINK_VERSION_NOT_FOUND',
            message: `Issue ${issue.record.id} references missing Design Doc ${link.id}${pinned}.`,
          },
        ];
      }),
      config,
    );
  };

  return { resolver, linkValidator };
}

/** Captures both shards once so callbacks cannot observe separate file states. */
function captureConfigs(
  options: IssuesDesignDocsCompositionOptions,
  cwd: string,
): { readonly designDocsConfig: DesignDocsConfig; readonly issuesConfig: IssueConfig } {
  if (options.snapshot !== undefined) {
    if (
      options.env !== undefined ||
      options.issuesConfigOverrides !== undefined ||
      options.designDocsConfigOverrides !== undefined
    ) {
      throw new TypeError('A supplied configuration snapshot cannot be combined with composition overrides.');
    }
    return {
      designDocsConfig: options.snapshot.get(designDocsConfigContribution) as DesignDocsConfig,
      issuesConfig: options.snapshot.get(issueConfigContribution) as IssueConfig,
    };
  }

  const registry = createConfigRegistry([issueConfigContribution, designDocsConfigContribution]);
  const snapshot = resolveConfig(registry, {
    cwd,
    env: options.env ?? process.env,
    overrides: {
      modules: {
        issues: options.issuesConfigOverrides ?? {},
        design_docs: options.designDocsConfigOverrides ?? {},
      },
    },
  });
  return {
    designDocsConfig: snapshot.get(designDocsConfigContribution) as DesignDocsConfig,
    issuesConfig: snapshot.get(issueConfigContribution) as IssueConfig,
  };
}

function addressKey(address: { readonly id: string; readonly version?: number }): string {
  return `${address.id}\0${address.version ?? ''}`;
}

function boundedFindings<T>(findings: readonly T[], config: IssueConfig): readonly T[] {
  const bounded: T[] = [];
  for (const finding of findings.slice(0, config.security.max_query_rows)) {
    const candidate = [...bounded, finding];
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > config.security.max_result_bytes) break;
    bounded.push(finding);
  }
  if (findings.length > 0 && bounded.length === 0)
    throw new DesignDocsError(
      'resource_limit',
      'ISSUE_FINDING_LIMIT',
      'Issues validation findings exceed the configured result byte limit.',
    );
  return bounded;
}

function issueStoreLimits(config: IssueConfig): StoreLimits {
  return {
    ...DEFAULT_STORE_LIMITS,
    maxFileBytes: config.security.max_file_bytes,
    maxFiles: config.security.max_files,
    maxTotalBytes: config.security.max_total_bytes,
    maxBatchPaths: config.security.max_batch_paths,
    maxBeforeImageBytes: config.security.max_total_bytes,
    maxTemporaryBytes: config.security.max_total_bytes,
    maxStatementParameterBytes: Math.min(
      Number.MAX_SAFE_INTEGER,
      Math.max(DEFAULT_STORE_LIMITS.maxStatementParameterBytes, config.security.max_file_bytes + 64 * 1024),
    ),
    maxQueryRows: config.security.max_query_rows,
    maxQueryResultBytes: Math.max(config.security.max_result_bytes, config.security.max_file_bytes + 64 * 1024),
  };
}
