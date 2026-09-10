import {
  scanManagedFiles,
  resolveManagedPath,
  type ByteRevision,
  type ManagedPath,
  type ManagedRoot,
  type RepositoryLease,
  type OperationControl,
} from '@neottia/repository-store';
import { decodeIssue, filenameIssueId, issueFilename } from './codec.js';
import { IssueError } from './errors.js';
import type { IssueLocation, IssueRecord, IssueValidationReport } from './schemas.js';

/** One canonical issue plus its exact publication evidence. */
export interface CatalogIssue {
  readonly record: IssueRecord;
  readonly revision: `v1:${string}`;
  /** Native repository-store evidence used only for durable publication. */
  readonly byteRevision: ByteRevision;
  readonly location: IssueLocation;
  readonly path: ManagedPath;
  readonly relativePath: string;
  readonly canonical: boolean;
  readonly size: number;
}

/** Reads the complete active/archive snapshot under one authority lease. */
export async function loadIssueCatalog(
  root: ManagedRoot,
  lease: RepositoryLease,
  issueRoot: string,
  prefix: string,
  control: OperationControl = {},
): Promise<Map<string, CatalogIssue>> {
  const inspected = await inspectIssueCatalog(root, lease, issueRoot, prefix, control);
  const firstError = inspected.findings.find((finding) => finding.severity === 'error');
  if (firstError)
    throw new IssueError(firstError.message, 'validation', firstError.code, {
      details: {
        ...(firstError.id ? { id: firstError.id } : {}),
        ...(firstError.path ? { path: firstError.path } : {}),
      },
    });
  return inspected.catalog;
}

/** Collects bounded per-file findings for issue_validate without hiding later defects. */
export async function inspectIssueCatalog(
  root: ManagedRoot,
  lease: RepositoryLease,
  issueRoot: string,
  prefix: string,
  control: OperationControl = {},
): Promise<{ catalog: Map<string, CatalogIssue>; findings: IssueValidationReport['findings'] }> {
  const start = resolveManagedPath(root, issueRoot);
  const files = await scanManagedFiles(root, lease, { under: [start], ...control });
  const catalog = new Map<string, CatalogIssue>();
  const findings: IssueValidationReport['findings'] = [];
  for (const file of files) {
    try {
      const nested = file.path.relativePath.slice(issueRoot.length + 1);
      const location: IssueLocation = nested.startsWith('archive/') ? 'archive' : 'active';
      const filename = location === 'archive' ? nested.slice('archive/'.length) : nested;
      if (filename.includes('/') || !/\.ya?ml$/u.test(filename))
        throw new IssueError(`Unexpected path in issue root: ${file.path.relativePath}`, 'validation', 'CATALOG_PATH', {
          details: { path: file.path.relativePath },
        });
      const expectedId = filenameIssueId(filename, prefix);
      if (!expectedId) throw new IssueError(`Invalid issue filename: ${filename}`, 'validation', 'FILENAME_INVALID');
      const decoded = decodeIssue(file.bytes, prefix, expectedId);
      if (filename !== issueFilename(decoded.record.id, decoded.record.title))
        throw new IssueError(
          `Issue filename is not canonical for ${decoded.record.id}.`,
          'validation',
          'FILENAME_MISMATCH',
          { details: { path: file.path.relativePath } },
        );
      if (catalog.has(decoded.record.id))
        throw new IssueError(
          `Duplicate issue ID across active/archive: ${decoded.record.id}`,
          'validation',
          'DUPLICATE_ID',
          { details: { id: decoded.record.id } },
        );
      catalog.set(decoded.record.id, {
        record: decoded.record,
        revision: decoded.revision,
        byteRevision: file.revision,
        location,
        path: file.path,
        relativePath: file.path.relativePath,
        canonical: decoded.canonical,
        size: file.size,
      });
    } catch (error: unknown) {
      const issue = error instanceof IssueError ? error : new IssueError(String(error));
      findings.push({
        severity: 'error',
        code: issue.code,
        message: issue.message,
        path: file.path.relativePath,
        ...(typeof issue.details?.id === 'string' ? { id: issue.details.id } : {}),
        recovery_hint: 'Correct or restore this canonical YAML file from version control.',
      });
      if (findings.length >= 1000) break;
    }
  }
  return { catalog, findings };
}
