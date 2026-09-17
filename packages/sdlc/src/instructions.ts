import { checksumText, compareCodeUnits, type Sha256 } from '@neottia/distribution';

import type { SdlcCompilerContext } from './compiler-context.js';
import { SDLC_COMMAND_IDS, SDLC_ROLE_IDS, type SdlcCommandId, type SdlcRoleId } from './lifecycle.js';

/** Compile-time capability slots populated by provider instruction packs. */
export const SDLC_INSTRUCTION_SLOTS = Object.freeze([
  'issues',
  'documents',
  'source-control.local',
  'source-control.remote',
] as const);

/** Stable compile-time capability slot. */
export type SdlcInstructionSlot = (typeof SDLC_INSTRUCTION_SLOTS)[number];

/** Versioned provider instructions selected before prompts reach a harness. */
export interface SdlcInstructionPack {
  readonly id: string;
  readonly slot: SdlcInstructionSlot;
  readonly provider: string;
  readonly version: string;
  readonly content: string;
  readonly checksum: Sha256;
}

/** Versioned role instructions supplied by the portable role compiler. */
export interface SdlcRoleInstruction {
  readonly id: string;
  readonly command: SdlcCommandId;
  readonly role: SdlcRoleId;
  readonly version: string;
  readonly content: string;
  readonly checksum: Sha256;
}

/** Input accepted by the checksummed provider-pack constructor. */
export type SdlcInstructionPackInput = Omit<SdlcInstructionPack, 'checksum'>;

/** Input accepted by the checksummed role-instruction constructor. */
export type SdlcRoleInstructionInput = Omit<SdlcRoleInstruction, 'checksum'>;

/** Creates one immutable provider instruction pack with exact content integrity. */
export function createSdlcInstructionPack(input: SdlcInstructionPackInput): SdlcInstructionPack {
  validateIdentity(input.id, 'Instruction pack ID');
  validateIdentity(input.provider, 'Instruction provider');
  if (!SDLC_INSTRUCTION_SLOTS.includes(input.slot)) throw new TypeError('Instruction slot is invalid.');
  validateVersionAndContent(input.version, input.content, 'Instruction pack');
  return Object.freeze({ ...input, checksum: checksumText(input.content) });
}

/** Creates one immutable role instruction for a stable lifecycle invocation point. */
export function createSdlcRoleInstruction(input: SdlcRoleInstructionInput): SdlcRoleInstruction {
  validateIdentity(input.id, 'Role instruction ID');
  if (!SDLC_COMMAND_IDS.includes(input.command) || !SDLC_ROLE_IDS.includes(input.role)) {
    throw new TypeError('Role instruction invocation point is invalid.');
  }
  validateVersionAndContent(input.version, input.content, 'Role instruction');
  return Object.freeze({ ...input, checksum: checksumText(input.content) });
}

/** Built-in packs needed for the first filesystem-backed lifecycle. */
export const BUILTIN_SDLC_INSTRUCTION_PACKS = Object.freeze([
  createSdlcInstructionPack({
    id: 'neottia.issues.filesystem',
    slot: 'issues',
    provider: 'filesystem',
    version: '1.0.0',
    content:
      'Use the Neottia `issue_*` tools as the issue authority. Read before mutation, preserve exact revision evidence, record material progress with comments or status transitions, and never infer issue ownership from filenames.\n',
  }),
  createSdlcInstructionPack({
    id: 'neottia.documents.filesystem',
    slot: 'documents',
    provider: 'filesystem',
    version: '1.0.0',
    content:
      'Use the Neottia `document_*` tools as the document authority. Keep design decisions in canonical documents, validate before lifecycle transitions, and supply exact revision and approval evidence for updates.\n',
  }),
  createSdlcInstructionPack({
    id: 'neottia.source-control.git',
    slot: 'source-control.local',
    provider: 'git',
    version: '1.0.0',
    content:
      'Use local Git for source-control evidence. Inspect status and diffs before mutation, keep commits scoped and reviewable, and do not rewrite shared history. Treat commit, tag, push, merge, and publication as separate actions.\n',
  }),
  createSdlcInstructionPack({
    id: 'neottia.source-control.remote-none',
    slot: 'source-control.remote',
    provider: 'none',
    version: '1.0.0',
    content:
      'No remote source-control provider is selected. Stop before push, pull-request, merge, remote release, or deployment actions and report the local handoff instead.\n',
  }),
] satisfies readonly SdlcInstructionPack[]);

/** Selects exactly one instruction pack for every resolved capability. */
export function selectSdlcInstructionPacks(
  context: SdlcCompilerContext,
  additions: readonly SdlcInstructionPack[] = [],
): readonly SdlcInstructionPack[] {
  const packs = [...BUILTIN_SDLC_INSTRUCTION_PACKS, ...additions];
  for (const pack of packs) validateSdlcInstructionPack(pack);
  const requested: Readonly<Record<SdlcInstructionSlot, string>> = Object.freeze({
    issues: context.issues.provider,
    documents: context.documents.provider,
    'source-control.local': context.sourceControl.local,
    'source-control.remote': context.sourceControl.remote.enabled ? context.sourceControl.remote.provider : 'none',
  });
  return Object.freeze(
    SDLC_INSTRUCTION_SLOTS.map((slot) => {
      const matches = packs.filter((pack) => pack.slot === slot && pack.provider === requested[slot]);
      if (matches.length !== 1) {
        throw new TypeError(
          matches.length === 0
            ? `No instruction pack exists for ${slot}:${requested[slot]}.`
            : `Instruction pack selection is ambiguous for ${slot}:${requested[slot]}.`,
        );
      }
      return matches[0]!;
    }).sort((left, right) => compareCodeUnits(left.slot, right.slot)),
  );
}

/** Validates a decoded provider pack before it enters a checksummed manifest. */
export function validateSdlcInstructionPack(pack: SdlcInstructionPack): void {
  validateIdentity(pack.id, 'Instruction pack ID');
  validateIdentity(pack.provider, 'Instruction provider');
  if (!SDLC_INSTRUCTION_SLOTS.includes(pack.slot)) throw new TypeError('Instruction slot is invalid.');
  validateVersionAndContent(pack.version, pack.content, 'Instruction pack');
  if (checksumText(pack.content) !== pack.checksum) throw new TypeError('Instruction pack checksum does not match.');
}

/** Validates a decoded role instruction before template rendering. */
export function validateSdlcRoleInstruction(role: SdlcRoleInstruction): void {
  validateIdentity(role.id, 'Role instruction ID');
  if (!SDLC_COMMAND_IDS.includes(role.command) || !SDLC_ROLE_IDS.includes(role.role)) {
    throw new TypeError('Role instruction invocation point is invalid.');
  }
  validateVersionAndContent(role.version, role.content, 'Role instruction');
  if (checksumText(role.content) !== role.checksum) throw new TypeError('Role instruction checksum does not match.');
}

/** Restricts manifest identities to portable lowercase segments. */
function validateIdentity(value: string, label: string): void {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(value)) throw new TypeError(`${label} is invalid.`);
}

/** Checks human-authored version and instruction text. */
function validateVersionAndContent(version: string, content: string, label: string): void {
  if (version.trim().length === 0 || content.trim().length === 0) throw new TypeError(`${label} is incomplete.`);
}
