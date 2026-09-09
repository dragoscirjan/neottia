import type { Stats } from 'node:fs';
import type { StoreLimits } from '../limits.js';

/** Internal symbol prevents callers from forging authority-scoped handles. */
export const ROOT_STATE = Symbol('repository-store.root');
/** Internal symbol prevents callers from forging managed paths. */
export const PATH_STATE = Symbol('repository-store.path');
/** Internal symbol prevents callers from forging repository leases. */
export const LEASE_STATE = Symbol('repository-store.lease');

/** Runtime state retained by an opaque managed root. */
export interface RootState {
  readonly authorityRoot: string;
  readonly managedRoot: string;
  readonly authorityId: string;
  /** Distinguishes managed subtrees that intentionally share one authority lease. */
  readonly managedRootId: string;
  readonly limits: StoreLimits;
}

/** A filesystem authority plus one managed subtree. */
export interface ManagedRoot {
  readonly authorityRoot: string;
  readonly managedRoot: string;
  readonly [ROOT_STATE]: RootState;
}

/** A validated relative path bound to one authority. */
export interface ManagedPath {
  readonly relativePath: string;
  readonly [PATH_STATE]: {
    readonly authorityId: string;
    readonly managedRootId: string;
    readonly absolutePath: string;
  };
}

/** Checks both authority and managed-subtree identity for an opaque path. */
export function managedPathBelongsToRoot(root: ManagedRoot, path: ManagedPath): boolean {
  return (
    path[PATH_STATE]?.authorityId === root[ROOT_STATE]?.authorityId &&
    path[PATH_STATE]?.managedRootId === root[ROOT_STATE]?.managedRootId
  );
}

/** A live repository-local lease passed explicitly to I/O operations. */
export interface RepositoryLease {
  readonly authorityRoot: string;
  readonly [LEASE_STATE]: {
    readonly authorityId: string;
    readonly token: string;
    readonly lockPath: string;
    readonly lockIdentity: Stats;
    readonly ownerIdentity: Stats;
    active: boolean;
  };
}
