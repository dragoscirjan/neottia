# Neottia SDLC operating protocol

This skill carries the concrete operating procedure for the six canonical lifecycle commands: Plan, Build, Verify, Release, Continue, and Refresh. The compiled commands own lifecycle policy, provider instructions, role invocation, and approval points. This skill owns how the work is resolved, evidenced, checkpointed, approved, and handed back.

Follow this protocol whenever a compiled lifecycle command is running. When this skill and the running command disagree, the running command wins.

## Shared rules

- One lifecycle run owns exactly one Epic. Every command resolves that Epic first; a command that cannot resolve one stops instead of inventing ownership.
- Durable lifecycle state lives only in the configured issue and document authorities. The compiled command instructions name the exact tools for the selected providers. Never edit the backing files of canonical records directly, and never bypass their authorities; ordinary source-file edits follow the compiled local source-control workflow instead. Every record mutation carries the latest known revision; a stale or missing revision is an error, never an overwrite.
- Record material progress as append-only comments or status transitions with the acting role, the intent, and evidence references. Comments are history. Never rewrite or delete them except through the authorities' documented archival operations.
- Approval is explicit, current, and scoped to the stated action. Silence, prior consent, and role assignment are not approval.
- These instructions are guidance. They do not grant host permissions. Honor host-enforced restrictions and request approval where a command requires it.
- Record every stopping outcome on the owning Epic before the run stops, so Continue can recover without guessing. A stop that happens before an owning Epic is resolved, such as waiting for candidate selection, returns candidates without a checkpoint; record a checkpoint once ownership is resolved.

## Durable checkpoint format

Lifecycle progress is durable only through checkpoint comments in this exact format, recorded on the owning Epic:

    <!-- neottia-sdlc:checkpoint
    phase: plan | build | verify | release
    step: B-3
    status: completed | blocked | needs-approval
    evidence: issue EPIC-1@rev; document HLD-2@rev; commit abc1234; check npm test=pass
    next: verify
    -->

Checkpoint rules:

- Append one checkpoint when a step completes, blocks, or needs approval. Checkpoints are append-only, and the newest valid checkpoint defines the authoritative phase and step.
- `phase` is one of the four delivery phases. A run without an earlier checkpoint may write a `plan` checkpoint only after plan approval; otherwise never write a phase that an earlier checkpoint does not support.
- `step` is a short stable identifier for the work item or action, such as a child issue ID or a release action.
- `status` is `completed` for finished steps, `blocked` when work cannot proceed, and `needs-approval` when the next action awaits an approval that has not been given.
- `evidence` lists exact record references with revisions, commit hashes, and check results. References must let a later command re-read the evidence without searching.
- `next` names one supported next public command or the next same-phase step. It is a recommendation only; a checkpoint never invokes a command.
- Malformed, incomplete, or out-of-order checkpoints are ignored. Never reconstruct a missing phase from prose or memory.

## Plan

Authoritative inputs: the user request, tracked work, documents, configuration, repository state, and the local source-control evidence supplied by the compiled command.

1. Resolve exactly one owning Epic. Accept an explicit issue ID or match the request against tracked work. When several candidates match, present at most five with their evidence and stop for selection; never pick one silently.
2. When no Epic exists, confirm the outcome with the user, then create one Epic and record the request, objectives, requirements, dependencies, risks, and acceptance evidence on it. Multiple independent outcomes become separate Epics only after explicit confirmation. An initiative parent is created only when the user confirms one.
3. Create or link proportionate design documents through the document authority. Request design approval where the documents require it before treating the design as approved.
4. Decompose the confirmed scope into executable child issues with bounded scope, required evidence, and a stop condition each. Every child references its owning Epic.
5. Record plan approval as an explicit Epic comment that names the approver, the approved scope, and the approved children. An Epic without recorded plan approval is not ready for Build.
6. Emit a plan checkpoint with `status: completed`, the approved evidence, and `next: build`. Stop without starting Build.

Stopping outcomes: an approved executable plan; confirmed parent-only scope without an executable Epic; missing approval; or a planning blocker recorded as a `blocked` checkpoint.

## Build

Authoritative inputs: the owning Epic, its recorded plan approval and plan checkpoint, ready child work, repository state, and local source control.

1. Require current plan approval. Missing, stale, contradicted, or revoked approval stops Build; return to Plan instead of proceeding.
2. Select ready child work owned by this Epic. Foreign, unlinked, or not-ready work is out of scope; record it and stop when nothing ready remains.
3. Implement bounded, reviewable slices. Keep commits scoped to the approved plan, follow the compiled local source-control instructions, and never rewrite shared history.
4. Record material decisions and validation evidence as comments on the child work: what changed, which checks ran, and their results.
5. On scope or ownership drift, stop and emit a `blocked` build checkpoint naming the drift and the affected records.
6. Emit a build checkpoint per completed slice with its evidence, then stop at the Verify boundary.

Stopping outcomes: bounded build evidence at the Verify boundary; a blocker; or a scope change routed back to Plan.

## Verify

Authoritative inputs: the owning Epic, build checkpoints and their evidence, declared checks, requirement and design evidence, and the compiled source-control instructions.

1. Map the implementation and recorded evidence to every requirement, acceptance criterion, and declared check. Report omitted, stale, or unreachable evidence instead of assuming it.
2. Run the declared checks and record each result with its command and outcome.
3. For each confirmed distinct defect occurrence, create or identify exactly one canonical Bug parented to the Epic, record the failure evidence on it, and route it back to Build. Defects never bypass Build.
4. Route requirement or design-scope changes back to Plan as scope changes, never into Build.
5. On pass, record a supported pass verdict as an Epic comment that lists the executed checks and their results, then emit a verify checkpoint with `status: completed` and `next: release`. Release requires this current verdict.

Stopping outcomes: a pass verdict ready for Release; confirmed defects routed to Build; scope changes routed to Plan; or an evidence gap recorded as a `blocked` checkpoint.

## Release

Authoritative inputs: the current verify pass verdict, the owning Epic, the compiled source-control and remote instructions, and the release scope.

1. Require the current successful verify verdict. Stale or missing verification stops Release; return to Verify instead.
2. Validate or prepare the feature branch, commits, push, pull request, and release metadata appropriate to the configured providers, following the compiled remote instructions.
3. Request fresh, action-specific approval immediately before every remote or irreversible operation: push, pull-request creation or mutation, tagging, publication, remote closure, or deployment. One approval never carries to the next action.
4. Keep merge and deployment human-authorized by default. Never merge, publish, deploy, close remote work, or perform destructive actions autonomously, even when every check passes.
5. Emit a release checkpoint recording the delivered evidence and remaining follow-up work.

Stopping outcomes: prepared release evidence awaiting an authorized action; a delivered release with recorded evidence; or a delivery blocker.

## Continue

Authoritative inputs: the owning Epic, its checkpoint history, provider records, and repository state.

1. Resolve one Epic. Without an explicit ID, present at most five unfinished candidates with their newest evidence and wait for selection.
2. Read the newest valid checkpoint. It defines the authoritative phase and the last step. Without a valid checkpoint, no phase is inferred: present the supported phase candidates for explicit selection instead.
3. Confirm the single step to resume with the user when the checkpoint is ambiguous, then resume exactly one same-phase step.
4. Record the resumed step's outcome as a checkpoint and stop without entering another phase. Recommend, never invoke, the next public command.

Stopping outcomes: one resumed step recorded; an ambiguity resolved by explicit selection; or a reconciliation stop.

## Refresh

Authoritative inputs: resolved configuration, provider records, repository state, and source-control evidence.

1. Reload the resolved configuration and reread provider-backed records through their authorities.
2. Inspect repository and source-control changes since the recorded evidence and identify drift: changed files, moved records, stale checkpoints, and superseded assumptions.
3. Report each changed assumption with its current evidence and what it affects.
4. Perform no lifecycle transition and no unapproved mutation. Recommend Continue or a new Plan and stop.

Stopping outcomes: a drift report with current evidence, or a report that nothing changed.

## Migration from earlier tooling

Earlier Neottia tooling exposed a larger per-phase command vocabulary. The six public commands are the only entry points now, and their procedures absorb that behavior: intake and design belong to Plan, implementation and child-work selection to Build, review to Verify, delivery to Release, resumption to Continue, and reconciliation to Refresh. Earlier work-item vocabularies map onto the canonical issue types carried by the issue authority: initiative, epic, story, task, and bug.
