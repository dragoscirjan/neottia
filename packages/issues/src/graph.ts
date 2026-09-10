import type { CatalogIssue } from './catalog.js';
import { compareCodePoints } from './codec.js';
import { IssueError } from './errors.js';
import type { Issue, IssueRecord, IssueType, IssueValidationReport } from './schemas.js';

const ALLOWED_PARENTS: Readonly<Record<IssueType, readonly IssueType[]>> = {
  initiative: [],
  epic: ['initiative'],
  story: ['epic', 'initiative'],
  task: ['story', 'epic'],
  bug: ['story', 'task', 'epic'],
};

/** Validates hierarchy and relationships over one complete canonical snapshot. */
export function validateIssueGraph(catalog: ReadonlyMap<string, CatalogIssue>): void {
  const finding = inspectIssueGraph(catalog)[0];
  if (finding)
    throw new IssueError(finding.message, 'validation', finding.code, {
      details: { ...(finding.id ? { id: finding.id } : {}), ...(finding.path ? { path: finding.path } : {}) },
    });
}

/** Collects bounded independent graph findings for actionable validation. */
export function inspectIssueGraph(catalog: ReadonlyMap<string, CatalogIssue>): IssueValidationReport['findings'] {
  const findings: IssueValidationReport['findings'] = [];
  const add = (code: string, message: string, id?: string): void => {
    if (findings.length < 1000)
      findings.push({
        severity: 'error',
        code,
        message,
        ...(id ? { id } : {}),
        recovery_hint: 'Correct the referenced issue graph and retry.',
      });
  };
  for (const [id, entry] of catalog) {
    const record = entry.record;
    if (record.parent) {
      const parent = catalog.get(record.parent);
      if (!parent) add('TARGET_NOT_FOUND', `Unresolved parent target ${record.parent} from ${id}.`, id);
      else {
        if (!ALLOWED_PARENTS[record.type].includes(parent.record.type))
          add('PARENT_TYPE', `Illegal ${record.type} parent type ${parent.record.type} for ${id}.`, id);
        if (entry.location === 'active' && parent.location === 'archive')
          add('PARENT_LOCATION', `Active child cannot have an archived parent: ${id}.`, id);
      }
    }
    for (const field of ['depends_on', 'relates_to', 'duplicates', 'supersedes'] as const)
      for (const target of record[field]) {
        if (target === id) add('SELF_RELATION', `${id} cannot ${field} itself.`, id);
        else if (!catalog.has(target)) add('TARGET_NOT_FOUND', `Unresolved ${field} target ${target} from ${id}.`, id);
        if (field === 'relates_to' && id > target)
          add('RELATION_OWNER', `Symmetric relates_to must be stored on lexical owner ${target}.`, id);
      }
  }
  for (const [label, edges] of [
    ['parent', (record: IssueRecord) => (record.parent ? [record.parent] : [])],
    ['dependency', (record: IssueRecord) => record.depends_on],
  ] as const) {
    try {
      assertAcyclic(catalog, label, edges);
    } catch (error: unknown) {
      const issue = error as IssueError;
      add(issue.code, issue.message);
    }
  }
  return findings;
}

/** Adds derived hierarchy and inverse relationship views to a canonical record. */
export function hydrateIssue(catalog: ReadonlyMap<string, CatalogIssue>, id: string): Issue {
  const entry = catalog.get(id);
  if (!entry) throw new IssueError(`Issue not found: ${id}`, 'not_found', 'ISSUE_NOT_FOUND', { details: { id } });
  const children: string[] = [];
  const blocks: string[] = [];
  const related: string[] = [...entry.record.relates_to];
  for (const [candidateId, candidate] of catalog) {
    if (candidate.record.parent === id) children.push(candidateId);
    if (candidate.record.depends_on.includes(id)) blocks.push(candidateId);
    if (candidate.record.relates_to.includes(id)) related.push(candidateId);
  }
  return {
    ...entry.record,
    revision: entry.revision,
    location: entry.location,
    children: children.sort(),
    blocks: blocks.sort(),
    blocked_by: [...entry.record.depends_on].sort(),
    related_to: [...new Set(related)].sort(),
  };
}

/** Returns a parent-rooted subtree in deterministic order. */
export function issueSubtree(
  catalog: ReadonlyMap<string, CatalogIssue>,
  rootId: string,
  location: 'active' | 'archive',
): readonly string[] {
  const root = catalog.get(rootId);
  if (!root || root.location !== location)
    throw new IssueError(`Issue not found in ${location}: ${rootId}`, 'not_found', 'ISSUE_NOT_FOUND');
  const result: string[] = [];
  const visit = (id: string): void => {
    result.push(id);
    for (const [childId, child] of [...catalog].sort(([left], [right]) => compareCodePoints(left, right)))
      if (child.location === location && child.record.parent === id) visit(childId);
  };
  visit(rootId);
  return result;
}

function assertAcyclic(
  catalog: ReadonlyMap<string, CatalogIssue>,
  label: string,
  edges: (record: IssueRecord) => readonly string[],
): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id))
      throw new IssueError(`${label} cycle includes ${id}.`, 'validation', `${label.toUpperCase()}_CYCLE`);
    if (visited.has(id)) return;
    visiting.add(id);
    const record = catalog.get(id)?.record;
    if (record) for (const target of edges(record)) if (catalog.has(target)) visit(target);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of catalog.keys()) visit(id);
}
