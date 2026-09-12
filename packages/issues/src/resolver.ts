import type { OperationControl, RepositoryLease } from '@neottia/repository-store';
import { z } from 'zod';
import { designDocumentReferenceSchema, type DesignDocumentReference } from './schemas.js';

const referenceFindingSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    id: z.string().optional(),
    version: z.number().int().positive().safe().optional(),
  })
  .strict();

const referenceResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('resolved'),
      reference: designDocumentReferenceSchema,
      resolvedVersion: z.number().int().positive().safe(),
      location: z.enum(['active', 'archive']),
      revision: z.string().regex(/^v1:[0-9a-f]{64}$/u),
    })
    .strict(),
  z
    .object({
      status: z.literal('unresolved'),
      reference: designDocumentReferenceSchema,
      reason: z.enum(['id_not_found', 'version_not_found']),
    })
    .strict(),
]);

/** Runtime resolver contract used to fail closed on untyped host implementations. */
export const designDocumentReferenceBatchSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), results: z.array(referenceResultSchema) }).strict(),
  z.object({ status: z.literal('target_invalid'), findings: z.array(referenceFindingSchema) }).strict(),
  z.object({ status: z.literal('target_disabled') }).strict(),
]);

/** A bounded diagnostic supplied when a design-doc snapshot is invalid. */
export interface DesignDocumentReferenceFinding {
  readonly code: string;
  readonly message: string;
  readonly id?: string;
  readonly version?: number;
}

/** Public revision returned by the Design Docs domain. */
export type DesignDocumentRevision = `v1:${string}`;

/** Canonical addressability result for one stable design-document reference. */
export type DesignDocumentReferenceResult =
  | {
      readonly status: 'resolved';
      readonly reference: DesignDocumentReference;
      readonly resolvedVersion: number;
      readonly location: 'active' | 'archive';
      readonly revision: DesignDocumentRevision;
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
