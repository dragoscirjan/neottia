import type { ByteRevision, OperationControl, RepositoryLease } from '@neottia/repository-store';
import type { DesignDocumentReference } from './schemas.js';

/** A bounded diagnostic supplied when a design-doc snapshot is invalid. */
export interface DesignDocumentReferenceFinding {
  readonly code: string;
  readonly message: string;
  readonly id?: string;
  readonly version?: number;
}

/** Canonical addressability result for one stable design-document reference. */
export type DesignDocumentReferenceResult =
  | {
      readonly status: 'resolved';
      readonly reference: DesignDocumentReference;
      readonly resolvedVersion: number;
      readonly location: 'active' | 'archive';
      readonly revision: ByteRevision;
    }
  | {
      readonly status: 'unresolved';
      readonly reference: DesignDocumentReference;
      readonly reason: 'id_not_found' | 'version_not_found';
    };

/** Batch resolution fails closed when the target domain is disabled or invalid. */
export type DesignDocumentReferenceBatch =
  | { readonly status: 'ok'; readonly results: readonly DesignDocumentReferenceResult[] }
  | { readonly status: 'target_invalid'; readonly findings: readonly DesignDocumentReferenceFinding[] }
  | { readonly status: 'target_disabled' };

export interface DesignDocumentReferenceContext extends OperationControl {
  /** Existing authority lease; implementations must not attempt a nested lease. */
  readonly lease: RepositoryLease;
}

/** Narrow one-way integration seam; Issues never imports Design Docs. */
export interface DesignDocumentReferenceResolver {
  resolveMany(
    references: readonly DesignDocumentReference[],
    context: DesignDocumentReferenceContext,
  ): Promise<DesignDocumentReferenceBatch>;
  importLegacyPath?(
    path: string,
    context: DesignDocumentReferenceContext,
  ): Promise<DesignDocumentReference | undefined>;
}
