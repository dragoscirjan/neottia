---
"@neottia/claude-code-adapter": minor
"@neottia/sdlc": minor
---

Add the Claude Code harness adapter and generalize SDLC role configuration.

`@neottia/claude-code-adapter` projects Claude Code commands, Agent Skills, custom agents, and project-scoped `.mcp.json` MCP operations. It rejects single-file extension projection and runtime package activation because Claude Code plugins require multi-file plugin packages, and it rejects portable per-tool permission metadata because agent files have no documented representation. `@neottia/sdlc` now accepts role assignment maps for any adapter ID in the portable asset-ID format under `agents.sdlc`, while keeping documented `pi` and `opencode` maps in the lowest-precedence defaults.
