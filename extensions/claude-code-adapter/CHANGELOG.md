# @neottia/claude-code-adapter

## 0.2.0

### Minor Changes

- [#145](https://github.com/dragoscirjan/neottia/pull/145) [`22444b7`](https://github.com/dragoscirjan/neottia/commit/22444b718e4c96bdfe713636247787595d37eba3) Thanks [@dragoscirjan](https://github.com/dragoscirjan)! - Add the Claude Code harness adapter and generalize SDLC role configuration.
  
  `@neottia/claude-code-adapter` projects Claude Code commands, Agent Skills, custom agents, and project-scoped `.mcp.json` MCP operations. It rejects single-file extension projection and runtime package activation because Claude Code plugins require multi-file plugin packages, and it rejects portable per-tool permission metadata because agent files have no documented representation. `@neottia/sdlc` now accepts role assignment maps for any adapter ID in the portable asset-ID format under `agents.sdlc`, while keeping documented `pi` and `opencode` maps in the lowest-precedence defaults.

### Patch Changes

- Updated dependencies [[`20f3913`](https://github.com/dragoscirjan/neottia/commit/20f391389811733db9662e137e0efe53f47dbdbe)]:
  - @neottia/harness-adapter@0.2.0
