import { isAbsolute, relative } from 'node:path';

import { applyHostUnitStates } from './host-config.js';
import {
  canonicalJson,
  checksumBytes,
  checksumText,
  compareCodeUnits,
  createReceipt,
  receiptEntryKey,
} from './manifest.js';
import type {
  ContainerState,
  ExpectedFile,
  InstallationConflict,
  InstallationPlan,
  InstallationSnapshot,
  InspectedUnit,
  InstallRoots,
  PlanMutation,
  PreviousUnitState,
  ReceiptEntry,
  Sha256,
  UnitState,
} from './types.js';

/** Creates a deterministic install, update, or uninstall plan without I/O. */
export function createInstallationPlan(
  snapshot: InstallationSnapshot,
  action: InstallationPlan['action'],
): InstallationPlan {
  if (snapshot.pendingTransaction) throw new TypeError('A pending installer transaction must be recovered first.');
  if (action === 'uninstall' && snapshot.receipt === undefined)
    throw new TypeError('Uninstall requires a valid receipt.');
  if (action !== 'uninstall' && snapshot.manifest === undefined)
    throw new TypeError('Install and update require a manifest.');
  if (action === 'update' && snapshot.receipt === undefined)
    throw new TypeError('Update requires an existing receipt.');

  const conflicts: InstallationConflict[] = [];
  const transitions: Array<{ unit: InspectedUnit; state: UnitState }> = [];
  const nextEntries: ReceiptEntry[] = [];
  for (const inspected of snapshot.units) {
    const conflict = classifyConflict(inspected);
    if (conflict !== undefined) conflicts.push(conflict);
    const keepDesired = action !== 'uninstall' && inspected.desired !== undefined;
    const state = keepDesired ? inspected.desired! : previousState(inspected.receipt);
    transitions.push({ unit: inspected, state });
    if (keepDesired) nextEntries.push(nextReceiptEntry(inspected));
  }

  const mutations = buildContentMutations(transitions, snapshot.roots);
  if (action === 'uninstall') {
    if (snapshot.receiptContainer.exists) {
      mutations.push({
        id: 'receipt.remove',
        kind: 'remove-file',
        role: 'receipt',
        path: snapshot.receiptPath,
        root: rootForPath(snapshot.receiptPath, snapshot.roots),
        before: expectedFile(snapshot.receiptContainer) as ExpectedFile & { readonly exists: true },
      });
    }
  } else {
    const manifest = snapshot.manifest!;
    const receipt = createReceipt({
      installationId: manifest.installationId,
      manifestChecksum: manifest.checksum,
      harnessId: manifest.harnessId,
      scope: manifest.scope,
      entries: nextEntries,
    });
    const content = canonicalJson(receipt);
    const digest = checksumText(content);
    if (!snapshot.receiptContainer.exists || snapshot.receiptContainer.checksum !== digest) {
      mutations.push({
        id: 'receipt.write',
        kind: 'write-file',
        role: 'receipt',
        path: snapshot.receiptPath,
        root: rootForPath(snapshot.receiptPath, snapshot.roots),
        before: expectedFile(snapshot.receiptContainer),
        encoding: 'utf8',
        content,
        checksum: digest,
      });
    }
  }

  mutations.sort(
    (left, right) =>
      Number(left.role === 'receipt') - Number(right.role === 'receipt') || compareCodeUnits(left.path, right.path),
  );
  const unsigned = {
    schemaVersion: 1 as const,
    id: `${action}.${snapshot.receipt?.installationId ?? snapshot.manifest!.installationId}`,
    action,
    receiptPath: snapshot.receiptPath,
    receiptRoot: rootForPath(snapshot.receiptPath, snapshot.roots),
    mutations,
    conflicts: conflicts.sort((left, right) => compareCodeUnits(left.id, right.id)),
    ...(action === 'uninstall' || snapshot.manifest?.reloadNotice === undefined
      ? {}
      : { reloadNotice: snapshot.manifest.reloadNotice }),
  };
  return freezePlan({ ...unsigned, digest: checksumText(canonicalJson(unsigned)) });
}

/** Applies exact conflict approvals and returns a newly digested plan. */
export function authorizePlan(plan: InstallationPlan, approvedConflictIds: readonly string[]): InstallationPlan {
  validatePlan(plan);
  const available = new Set(plan.conflicts.map((conflict) => conflict.id));
  const approvals = new Set(approvedConflictIds);
  for (const approval of approvals) {
    if (!available.has(approval)) throw new TypeError(`Unknown conflict approval: ${approval}`);
  }
  const unsigned = {
    schemaVersion: plan.schemaVersion,
    id: plan.id,
    action: plan.action,
    receiptPath: plan.receiptPath,
    receiptRoot: plan.receiptRoot,
    mutations: plan.mutations,
    conflicts: plan.conflicts.map((conflict) => ({ ...conflict, approved: approvals.has(conflict.id) })),
    ...(plan.reloadNotice === undefined ? {} : { reloadNotice: plan.reloadNotice }),
  };
  return freezePlan({ ...unsigned, digest: checksumText(canonicalJson(unsigned)) });
}

/** Verifies a plan loaded from disk before apply. */
export function validatePlan(plan: InstallationPlan): void {
  if (
    plan.schemaVersion !== 1 ||
    !isContainedPath(plan.receiptPath, plan.receiptRoot) ||
    !Array.isArray(plan.mutations) ||
    !Array.isArray(plan.conflicts)
  ) {
    throw new TypeError('Installation plan schema is invalid.');
  }
  const { digest, ...unsigned } = plan;
  if (checksumText(canonicalJson(unsigned)) !== digest) throw new TypeError('Installation plan digest does not match.');
  const paths = new Set<string>();
  for (const mutation of plan.mutations) {
    if (!isAbsolute(mutation.path) || !isContainedPath(mutation.path, mutation.root) || paths.has(mutation.path)) {
      throw new TypeError('Installation plan paths are invalid.');
    }
    paths.add(mutation.path);
    if (mutation.kind === 'write-file') {
      const bytes = Buffer.from(mutation.content, mutation.encoding);
      if (checksumBytes(bytes) !== mutation.checksum) throw new TypeError('Planned file checksum does not match.');
    }
  }
}

/** Requires every exact conflict to be authorized before mutation. */
export function assertPlanAuthorized(plan: InstallationPlan): void {
  validatePlan(plan);
  const pending = plan.conflicts.filter((conflict) => !conflict.approved);
  if (pending.length > 0) throw new TypeError(`Installation plan has ${pending.length} unapproved conflict(s).`);
}

/** Determines whether current state requires an individual approval. */
function classifyConflict(inspected: InspectedUnit): InstallationConflict | undefined {
  let reason: InstallationConflict['reason'] | undefined;
  if (inspected.receipt === undefined) {
    if (inspected.current.exists) reason = 'unowned-existing';
  } else if (!stateMatchesReceipt(inspected.current, inspected.receipt.checksum)) {
    reason = 'modified-owned';
  }
  if (reason === undefined) return undefined;
  const keyDigest = checksumText(receiptEntryKey(inspected)).slice('sha256:'.length, 'sha256:'.length + 16);
  return Object.freeze({
    id: `conflict.${keyDigest}`,
    assetId: inspected.assetId,
    path: inspected.path,
    reason,
    approved: false,
  });
}

/** Creates the next receipt entry while retaining the original displaced state. */
function nextReceiptEntry(inspected: InspectedUnit): ReceiptEntry {
  if (inspected.desired === undefined || inspected.source === undefined || inspected.desired.checksum === undefined) {
    throw new TypeError('Desired unit is incomplete.');
  }
  return {
    assetId: inspected.assetId,
    target: inspected.target,
    unit: inspected.unit,
    owner: 'neottia',
    source: inspected.source,
    checksum: inspected.desired.checksum,
    previous: inspected.receipt?.previous ?? displacedState(inspected.current),
  };
}

/** Converts a current unit into uninstall restoration evidence. */
function displacedState(state: UnitState): PreviousUnitState {
  if (!state.exists) return Object.freeze({ kind: 'absent' });
  if (state.checksum === undefined || state.encoding === undefined || state.content === undefined) {
    throw new TypeError('Current unit lacks displaced content.');
  }
  return Object.freeze({
    kind: 'displaced',
    checksum: state.checksum,
    encoding: state.encoding,
    content: state.content,
  });
}

/** Returns the original state recorded by a receipt. */
function previousState(receipt: ReceiptEntry | undefined): UnitState {
  if (receipt === undefined || receipt.previous.kind === 'absent') return Object.freeze({ exists: false });
  return Object.freeze({
    exists: true,
    checksum: receipt.previous.checksum,
    encoding: receipt.previous.encoding,
    content: receipt.previous.content,
  });
}

/** Groups entry-level changes into exact containing-file mutations. */
function buildContentMutations(
  transitions: readonly { readonly unit: InspectedUnit; readonly state: UnitState }[],
  roots: InstallRoots,
): PlanMutation[] {
  const groups = new Map<string, Array<{ unit: InspectedUnit; state: UnitState }>>();
  for (const transition of transitions) {
    const list = groups.get(transition.unit.path) ?? [];
    list.push(transition);
    groups.set(transition.unit.path, list);
  }

  const mutations: PlanMutation[] = [];
  for (const [path, group] of [...groups.entries()].sort(([left], [right]) => compareCodeUnits(left, right))) {
    const container = group[0]!.unit.container;
    if (group.some((entry) => !sameContainer(container, entry.unit.container))) {
      throw new TypeError('Units for one path have inconsistent snapshots.');
    }
    const fileTransitions = group.filter((entry) => entry.unit.unit.kind === 'file');
    if (fileTransitions.length > 0) {
      if (group.length !== 1) throw new TypeError('A file target cannot also contain host configuration units.');
      const state = fileTransitions[0]!.state;
      if (!state.exists) {
        if (container.exists) {
          mutations.push({
            id: `file.remove.${mutations.length}`,
            kind: 'remove-file',
            role: 'asset',
            path,
            root: rootForPath(path, roots),
            before: expectedFile(container) as ExpectedFile & { readonly exists: true },
          });
        }
      } else if (!container.exists || container.checksum !== state.checksum) {
        if (state.content === undefined || (state.encoding !== 'utf8' && state.encoding !== 'base64')) {
          throw new TypeError('Desired file state is invalid.');
        }
        mutations.push({
          id: `file.write.${mutations.length}`,
          kind: 'write-file',
          role: 'asset',
          path,
          root: rootForPath(path, roots),
          before: expectedFile(container),
          encoding: state.encoding,
          content: state.content,
          checksum: state.checksum!,
        });
      }
      continue;
    }

    const currentContent = container.exists ? Buffer.from(container.content!, 'base64').toString('utf8') : undefined;
    const output = applyHostUnitStates(
      currentContent,
      group.map((entry) => ({ unit: entry.unit.unit, state: entry.state })),
    );
    const digest = checksumText(output);
    if (!container.exists || container.checksum !== digest) {
      mutations.push({
        id: `config.write.${mutations.length}`,
        kind: 'write-file',
        role: 'host-config',
        path,
        root: rootForPath(path, roots),
        before: expectedFile(container),
        encoding: 'utf8',
        content: output,
        checksum: digest,
      });
    }
  }
  return mutations;
}

/** Selects the most specific approved root containing a mutation path. */
function rootForPath(path: string, roots: InstallRoots): string {
  const matches = Object.values(roots)
    .filter((root) => isContainedPath(path, root))
    .sort((left, right) => right.length - left.length);
  if (matches.length === 0) throw new TypeError(`Mutation path is outside configured install roots: ${path}`);
  return matches[0]!;
}

/** Checks lexical containment while rejecting writes to the root itself. */
function isContainedPath(path: string, root: string): boolean {
  if (!isAbsolute(path) || !isAbsolute(root)) return false;
  const relation = relative(root, path);
  return relation !== '' && !relation.startsWith('..') && !isAbsolute(relation);
}

/** Creates a full-file optimistic concurrency guard. */
function expectedFile(container: ContainerState): ExpectedFile {
  return container.exists ? { exists: true, checksum: container.checksum! } : { exists: false };
}

/** Compares entry state to the receipt rather than the containing file. */
function stateMatchesReceipt(state: UnitState, checksum: Sha256): boolean {
  return state.exists && state.checksum === checksum;
}

/** Checks that repeated unit snapshots came from identical container bytes. */
function sameContainer(left: ContainerState, right: ContainerState): boolean {
  return left.path === right.path && left.exists === right.exists && left.checksum === right.checksum;
}

/** Detaches and freezes plan data returned to callers. */
function freezePlan(plan: InstallationPlan): InstallationPlan {
  return deepFreeze(structuredClone(plan));
}

/** Recursively freezes a plan. */
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
