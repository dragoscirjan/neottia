import type { NeottiaRuntimePackageId } from '@neottia/harness-adapter';

/** One exact runtime package version shipped for one harness. */
export interface CatalogEntry {
  readonly logicalId: NeottiaRuntimePackageId;
  readonly version: string;
}

/**
 * Exact first-party runtime package versions compatible with this CLI release.
 * Versions change only through the release pipeline, never from a registry.
 */
export const RUNTIME_PACKAGE_CATALOG: Readonly<Record<string, readonly CatalogEntry[]>> = Object.freeze({
  pi: Object.freeze([
    { logicalId: 'memory', version: '0.1.1' },
    { logicalId: 'issues', version: '0.2.0' },
    { logicalId: 'design-docs', version: '0.2.0' },
    { logicalId: 'searchable', version: '0.2.0' },
  ] as const),
  opencode: Object.freeze([
    { logicalId: 'memory', version: '0.1.1' },
    { logicalId: 'issues', version: '0.2.0' },
    { logicalId: 'design-docs', version: '0.2.0' },
    { logicalId: 'searchable', version: '0.2.0' },
  ] as const),
});

/** Returns the exact catalog entry for one harness and runtime module, or undefined. */
export function catalogEntry(harnessId: string, logicalId: NeottiaRuntimePackageId): CatalogEntry | undefined {
  return RUNTIME_PACKAGE_CATALOG[harnessId]?.find((entry) => entry.logicalId === logicalId);
}
