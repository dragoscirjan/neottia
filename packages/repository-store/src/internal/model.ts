import type { Stats } from 'node:fs';
import type { StoreLimits } from '../limits.js';

/** Runtime state retained outside the public managed-root handle. */
export interface RootState {
  readonly authorityRoot: string;
  readonly managedRoot: string;
  readonly authorityId: string;
  /** Distinguishes managed subtrees that intentionally share one authority lease. */
  readonly managedRootId: string;
  readonly limits: StoreLimits;
}

/** Internal state for one validated managed path. */
export interface PathState {
  readonly authorityId: string;
  readonly managedRootId: string;
  readonly absolutePath: string;
}

/** Mutable liveness state retained outside one public lease handle. */
export interface LeaseState {
  readonly authorityId: string;
  readonly token: string;
  readonly lockPath: string;
  readonly lockIdentity: Stats;
  readonly ownerIdentity: Stats;
  active: boolean;
}

/** A filesystem authority plus one managed subtree. */
export interface ManagedRoot {
  readonly authorityRoot: string;
  readonly managedRoot: string;
}

/** A validated relative path bound to one authority. */
export interface ManagedPath {
  readonly relativePath: string;
}

/** A live repository-local lease passed explicitly to I/O operations. */
export interface RepositoryLease {
  readonly authorityRoot: string;
}

// WeakMaps keep authority-bearing paths and mutable lease state inaccessible to
// callers, even when they enumerate symbols on the frozen public handles.
const rootStates = new WeakMap<ManagedRoot, RootState>();
const pathStates = new WeakMap<ManagedPath, PathState>();
const leaseStates = new WeakMap<RepositoryLease, LeaseState>();

/** Creates a frozen public root backed by private state. */
export function createManagedRoot(state: RootState): ManagedRoot {
  const root = Object.freeze({ authorityRoot: state.authorityRoot, managedRoot: state.managedRoot });
  rootStates.set(root, state);
  return root;
}

/** Creates a frozen public path backed by private authority state. */
export function createManagedPath(relativePath: string, state: PathState): ManagedPath {
  const path = Object.freeze({ relativePath });
  pathStates.set(path, state);
  return path;
}

/** Creates a frozen public lease backed by private mutable liveness state. */
export function createRepositoryLease(authorityRoot: string, state: LeaseState): RepositoryLease {
  const lease = Object.freeze({ authorityRoot });
  leaseStates.set(lease, state);
  return lease;
}

/** Returns private root state only for a package-created handle. */
export function getRootState(root: ManagedRoot): RootState | undefined {
  return rootStates.get(root);
}

/** Returns private path state only for a package-created handle. */
export function getPathState(path: ManagedPath): PathState | undefined {
  return pathStates.get(path);
}

/** Returns private lease state only for a package-created handle. */
export function getLeaseState(lease: RepositoryLease): LeaseState | undefined {
  return leaseStates.get(lease);
}

/** Checks both authority and managed-subtree identity for an opaque path. */
export function managedPathBelongsToRoot(root: ManagedRoot, path: ManagedPath): boolean {
  const rootState = getRootState(root);
  const pathState = getPathState(path);
  return (
    pathState !== undefined &&
    rootState !== undefined &&
    pathState.authorityId === rootState.authorityId &&
    pathState.managedRootId === rootState.managedRootId
  );
}
