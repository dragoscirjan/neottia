# Choose a supported harness

Neottia compiles the same lifecycle policy for three supported hosts. Choose the host that your team already uses.

| Harness                               | Lifecycle assets                                    | Runtime capabilities                              | Extra setup                             |
| ------------------------------------- | --------------------------------------------------- | ------------------------------------------------- | --------------------------------------- |
| [Pi](/harnesses/pi)                   | Project commands and the `neottia-sdlc` skill       | Native Pi extension packages                      | Restart the trusted project             |
| [OpenCode](/harnesses/opencode)       | Project commands, skill, and supported agent assets | Native OpenCode plugin packages                   | Restart OpenCode                        |
| [Claude Code](/harnesses/claude-code) | Project commands, skills, and agent files           | Exact generic MCP packages in project `.mcp.json` | Open `/mcp` and approve project servers |

For all three hosts, run the recommended installation from the target repository root, or pass `--project DIR`:

```sh
pnpm add --global @neottia/cli
neottia init --harness <claude-code|opencode|pi>
neottia apply
neottia doctor
```

Replace the placeholder with one harness ID. Repeat `--harness` during `init` when one repository supports multiple hosts.

`@neottia/harness-adapter` keeps host paths and configuration formats out of generated SDLC content and installation logic. Each adapter declares exact feature support and returns reviewable plans. The distribution installer owns filesystem changes and receipts.

Other clients may use the [generic MCP servers](/mcp/) if they can launch stdio processes. Neottia does not provide supported lifecycle distribution for those clients.

Codex, Kiro, GitHub Copilot CLI, and Visual Studio Code Copilot remain deferred. Do not treat generic MCP compatibility as lifecycle support.
