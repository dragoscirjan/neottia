# @neottia/testkit

Internal test infrastructure for Neottia: temp-project fixtures, MCP config writers, harness runners, and the real-harness integration tests for the memory MCP server.

**Private package** — never published.

## What it provides

| Helper                                                                         | Purpose                                                                                                                    |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `createTempProject(options?)`                                                  | Disposable project with an enabled `skills.memory` config shard (temp folders only — the repository stays immutable)       |
| `seedMemory(project, inputs)`                                                  | Seed canonical memory records deterministically through `@neottia/memory-core` (no LLM involved)                           |
| `writeOpencodeMcpConfig` / `writeMcpServersJsonFile` / `writeServersMcpConfig` | MCP server declarations in each harness's verified format                                                                  |
| `ensureMemoryDistBuilt()`                                                      | Builds `@neottia/memory-core` and `@neottia/memory-mcp` dist output on demand (harnesses spawn the compiled `dist/cli.js`) |
| `runOpencode(options)`                                                         | Runs the configured OpenCode binary against a temp project with an isolated XDG environment and a free OpenRouter model    |
| `opencodeReady()` / `openrouterModelId()`                                      | Test gating (stored OpenCode auth or `OPENROUTER_API_KEY`) and free-model selection                                        |

## Running the harness integration tests

```bash
OPENROUTER_API_KEY=sk-or-... mise run test:harness   # explicit key
# or, if OpenCode already has working OpenRouter auth stored:
mise run test:harness
```

Tests **skip cleanly** when OpenRouter auth is missing or invalid and when harness binaries are unavailable — `mise run validate` never depends on them.

## How the isolation works

Harness tests spawn real AI harnesses, which write state everywhere. The fixture isolates all of it inside the temp project:

| Isolated path                               | Why                                                                                                                                                                                                                          |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `XDG_DATA_HOME` → `<project>/.xdg-data`     | OpenCode auth.json and logs; a fresh `auth.json` is written from the effective key so a stale stored credential cannot break the run                                                                                         |
| `XDG_CONFIG_HOME` → `<project>/.xdg-config` | A minimal global config — otherwise the user's global plugins and MCP servers leak in and can **shadow our tool names** (this exact failure mode: a global `memory_search` from another MCP server answered instead of ours) |
| `cwd` → `<project>`                         | Memory files and harness session data land in the temp tree                                                                                                                                                                  |
| `opencode.json` in the project              | Registers the memory MCP server via `node <repo>/packages/memory-mcp/dist/cli.js` (so unpublished local code is tested)                                                                                                      |

## Gotchas learned the hard way

- **Tool-name collisions**: a global harness config registering its own `memory_search` silently outranks (or shadows) the server under test. Always isolate `XDG_CONFIG_HOME`.
- **Free OpenRouter models rotate**: the model is resolved live from OpenRouter's catalog (`:free` ids) with a preferred-candidates list; override with `NEOTTIA_TEST_OPENROUTER_MODEL`.
- **LLM assertions must be loose**: assert on seeded keywords (unique codenames) in the output, and verify writes through the filesystem, never through the model's claims.
- **Prompt tool names explicitly**: free models pick wrong-but-similar tools (e.g. another server's `memory_json_search_nodes`) unless the prompt names the exact tool.

## License

MIT — see [LICENSE](./LICENSE).
