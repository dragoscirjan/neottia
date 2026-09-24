# Operating protocol

Every compiled lifecycle command loads one shared skill named `neottia-sdlc`. The skill carries the operating protocol: how a run resolves one owning Epic, records durable evidence, checkpoints phase progress, records approvals, and hands back after every stopping outcome. The running command always wins when the skill and the command text disagree.

Adapters project the skill identically for Pi, OpenCode, and Claude Code at `.pi/skills/neottia-sdlc/SKILL.md`, `.opencode/skills/neottia-sdlc/SKILL.md`, and `.claude/skills/neottia-sdlc/SKILL.md`.

## What the protocol covers

The compiled commands own lifecycle policy: transitions, approval points, stop conditions, role invocation, and provider instructions. The shared skill owns procedure:

- one lifecycle run owns exactly one Epic, resolved first or the command stops;
- durable state lives only in the configured issue and document authorities, and every mutation carries the latest known revision, so a stale revision fails instead of overwriting;
- material progress is recorded as append-only comments and status transitions with acting role, intent, and evidence references;
- approval is explicit, current, and scoped to one action; silence, prior consent, and role assignment are not approval;
- command text does not grant host permissions.

## The checkpoint format

The protocol defines one durable checkpoint format for phase progress. A checkpoint is an append-only comment on the owning Epic:

```text
<!-- neottia-sdlc:checkpoint
phase: build
step: B-3
status: completed
evidence: issue EPIC-1@rev2; commit abc1234; check npm test=pass
next: verify
-->
```

`phase` is one of the four delivery phases. A run without an earlier checkpoint may write a `plan` checkpoint only after plan approval; otherwise a checkpoint never writes a phase an earlier checkpoint does not support. `step` is a short stable identifier for the work item or action. `status` is `completed`, `blocked`, or `needs-approval`. `evidence` lists exact record references with revisions, commit hashes, and check results. `next` names one supported next public command or the next same-phase step as a recommendation, never an invocation.

Rules: checkpoints are append-only, the newest valid checkpoint defines the authoritative phase and step, and malformed, incomplete, or out-of-order checkpoints are ignored. Never reconstruct a missing phase from prose or memory.

## Per-command procedure

The skill gives each of the six commands its own section with authoritative inputs, a numbered procedure, and stopping outcomes. Highlights:

- Plan resolves exactly one owning Epic. Ambiguous requests surface at most five candidates and stop for selection. Plan records plan approval as an explicit Epic comment and stops before Build.
- Build requires current plan approval, selects ready child work owned by the Epic, and implements bounded slices. Scope or ownership drift produces a `blocked` checkpoint and a stop.
- Verify maps implementation and evidence to every requirement, routes each confirmed distinct defect to exactly one canonical Bug parented to the Epic and back to Build, and routes scope changes to Plan. Release requires a current pass verdict.
- Release requires the current verify verdict and requests fresh, action-specific approval before every push, pull-request action, tag, publication, remote closure, or deployment. Merge and deployment stay human-authorized by default.
- Continue reads the newest valid checkpoint and resumes exactly one same-phase step without advancing the phase. Without a valid checkpoint, Continue presents phase candidates for explicit selection instead of inferring phase state.
- Refresh reloads configuration and records, reports drift with current evidence, and performs no lifecycle transition.

## Customize or replace the skill body

The protocol ships as a packaged template with ID `neottia.sdlc.protocol` under `packages/sdlc/templates/protocol.md`. It is plain markdown, not a Twig template, and takes part in template-layer precedence:

1. packaged file;
2. explicit installed-package layer;
3. a global override at `<global root>/.neottia/templates/sdlc/protocol.md`;
4. a project override at `.neottia/templates/sdlc/protocol.md`.

A replacement must keep the checkpoint marker `neottia-sdlc:checkpoint`, the three checkpoint statuses, the six command sections, the exact sentence "They do not grant host permissions.", and provider-neutral wording. The compiler checks the protocol checksum, and the protocol tests enforce these invariants on the packaged body.

The compiler adds the projected skill asset under source id `sdlc.protocol` and records `asset.skill` in `changedFeatures` when the installation changes files.
