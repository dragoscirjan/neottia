# Configure portable SDLC roles

Neottia assigns the canonical SDLC roles at compile time. Each harness has its own assignment map under `agents.sdlc`, keyed by adapter ID, while the lifecycle templates keep the same role names and duties.

Role assignments choose who performs a lifecycle role. They do not choose an Issues, Documents, or source-control provider. They also do not grant host permissions or approve lifecycle actions.

## Role vocabulary

The compiler owns seven role declarations:

| Role                   | Required assignment | Invocation points | Duty                                                                               |
| ---------------------- | ------------------- | ----------------- | ---------------------------------------------------------------------------------- |
| `planner`              | Yes                 | Plan, Continue    | Define scope, dependencies, acceptance evidence, and approval boundaries.          |
| `researcher`           | No                  | Plan, Refresh     | Resolve bounded unknowns with sources and explicit uncertainty.                    |
| `implementer`          | Yes                 | Build             | Change only the approved scope and preserve implementation evidence.               |
| `reviewer`             | No                  | Verify            | Inspect results against requirements without silently changing them.               |
| `verifier`             | Yes                 | Verify            | Run required checks and return a supported verdict.                                |
| `release-coordinator`  | Yes                 | Release           | Prepare release evidence while keeping irreversible actions separately authorized. |
| `documentation-writer` | No                  | Build, Release    | Keep user documentation consistent with verified behavior.                         |

Required roles need an explicit assignment for the selected harness. Use `agent: current` when the current agent should perform one. Compilation fails before projection if a required role is absent or set to `false`.

Optional roles may be omitted or set to `false`. The current agent then performs that role when the lifecycle reaches its invocation point. The role is not skipped.

## Configure Pi

Pi does not declare portable native agent assets. Assign every required role to `current`:

```yaml
version: 1
agents:
  sdlc:
    pi:
      planner:
        agent: current
        required_tools: [issue_search, design_document_get]
      implementer:
        agent: current
        required_skills: [coding]
        required_tools: [read, edit]
      verifier:
        agent: current
        required_tools: [bash]
      release-coordinator:
        agent: current
        required_tools: [bash]
      researcher: false
      reviewer: false
      documentation-writer: false
```

A named Pi assignment fails with `ROLE_ASSIGNMENT_UNSUPPORTED`. Pi receives checksummed role instructions inside each generated command instead of separate agent files.

Pi accepts `model` and `thinking` values for current-agent assignments, but records them as advisory text. These hints cannot change the active model, permissions, tools, or isolation.

## Configure OpenCode

OpenCode supports native subagent assets. A named assignment creates `.opencode/agents/<agent>.md` and directs the lifecycle prompt to that exact route:

```yaml
version: 1
agents:
  sdlc:
    opencode:
      planner:
        agent: neottia-planner
        model: anthropic/claude-sonnet-4-5
        thinking: high
        required_skills: [planning]
        required_tools: [issue_search, design_document_get]
      researcher:
        agent: current
        required_tools: [web_search]
      implementer:
        agent: neottia-implementer
        required_skills: [coding]
        required_tools: [read, edit, bash]
      reviewer:
        agent: neottia-reviewer
        required_tools: [read]
      verifier:
        agent: neottia-verifier
        required_tools: [read, bash]
      release-coordinator:
        agent: current
        required_tools: [bash]
      documentation-writer: false
```

OpenCode projects `model` and the 24-step limit as supported agent metadata. OpenCode has no portable thinking field, so the generated instruction records `thinking` as advisory. A named route never falls back to the current agent or another agent if invocation fails.

Agent and skill identifiers use lowercase words separated by single hyphens, such as `neottia-planner`. Each named agent can serve only one role in a harness assignment map. Tool identifiers may also contain `.`, `_`, `:`, `/`, and `-` after the first alphanumeric character. Requirement lists accept at most 32 unique entries.

## Assignment fields

| Field             | Required              | Meaning                                                                                                                                     |
| ----------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`           | Yes for an assignment | `current` or a named native agent asset.                                                                                                    |
| `model`           | No                    | A provider/model identifier limited to 256 letters, digits, `.`, `_`, `:`, `/`, and `-`. The host may encode it as metadata when supported. |
| `thinking`        | No                    | `low`, `medium`, or `high`. The host may encode it as metadata when supported.                                                              |
| `required_skills` | No                    | Skills that must already be available before role work starts.                                                                              |
| `required_tools`  | No                    | Tools that must already be available before role work starts.                                                                               |

The schema rejects unknown fields. It has no permission, approval, provider, fallback, merge, release, or deployment option. Required tools and skills are preconditions, not grants. If a declared requirement is unavailable, the generated instruction requires a blocked result instead of a substitute route.

## Handoff and result limits

Every role invocation uses the same package-owned contract:

- direct current-agent work uses no subagent and stays within 24 role steps;
- a named route uses exactly one subagent invocation with at most 24 steps;
- native role agents do not delegate recursively;
- only the current command, role objective, approved scope, relevant evidence, approval points, and stop conditions in the handoff;
- no scope expansion or lifecycle transition inside the role;
- a result status of `completed`, `blocked`, or `needs-approval`;
- at most 20 evidence entries with locators and observed results;
- a result no larger than 8192 bytes;
- a handback recommendation instead of invoking the next action.

A role result is evidence. It cannot approve scope expansion, merge, publication, tagging, deployment, or another irreversible action.

## Profiles and harness isolation

Adapter maps are independent. Compiling Pi reads only `agents.sdlc.pi`; compiling OpenCode reads only `agents.sdlc.opencode`; compiling Claude Code reads only `agents.sdlc.claude-code`. An unused harness map does not enter the compiler checksum or generated provenance.

Profiles may replace or refine individual role assignments:

```yaml
version: 1
agents:
  sdlc:
    opencode:
      planner:
        agent: current
      implementer:
        agent: current
      verifier:
        agent: current
      release-coordinator:
        agent: current
profiles:
  native-agents:
    agents:
      sdlc:
        opencode:
          planner:
            agent: neottia-planner
            model: openai/gpt-5.2
```

Assignment objects merge by field through normal configuration precedence. Setting a role to `false` replaces the lower assignment atomically. If the role is required, the selected profile then fails SDLC compilation.

## Reproducibility and provenance

`createSdlcCompilerInput()` records the selected harness role context in the input checksum. It generates one checksummed role fragment for every canonical invocation point. Command provenance contains only the role fragments rendered by that command.

Named OpenCode agents become checksummed distribution assets. Pi does not receive placeholder agent assets. The compiler checks the adapter declaration against the host features captured in its input and rejects a mismatched or tampered declaration.

See [compile the canonical SDLC](/sdlc/) for compilation and installation, and [unified configuration](/configuration#sdlc-role-assignments) for the root configuration context.
