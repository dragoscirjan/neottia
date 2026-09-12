# @neottia/testkit

Private test infrastructure for Neottia. This workspace is not published for user installation.

## Exported helpers

Repository discovery exports `repoRoot`, `memoryMcpEntry`, `issuesMcpEntry`, `designDocsMcpEntry`, `ensureMemoryDistBuilt`, `ensureIssuesDistBuilt`, and `ensureDesignDocsDistBuilt`.

Temporary fixture exports are `createTempProject`, `createTempIssueProject`, `seedMemory`, `seedIssues`, `seedDesignDocs`, `CreateTempProjectOptions`, `CreateTempIssueProjectOptions`, `TempProject`, and `TempIssueProject`. Fixture cleanup removes only its temporary tree.

MCP configuration exports are `mcpServersDocument`, `writeMcpServersJsonFile`, `writeOpencodeMcpConfig`, `writeServersMcpConfig`, and `McpServerDefinition`.

Harness runner exports are `runPi`, `runOpencode`, `runPiWithModelFallback`, `runOpencodeWithModelFallback`, `piBin`, `piReady`, `binExists`, `opencodeReady`, `opencodeModel`, `openrouterApiKey`, `openrouterModelId`, `freeModelFallbackIds`, `resolveFreeOpenRouterModel`, `isTransientModelError`, `assertHarnessConclusive`, `assertHarnessSuccess`, and `HarnessRunResult`.

## Test tasks

`mise run test:harness` runs deterministic adapter and transport contracts. `mise run test:harness:live` is the opt-in live model acceptance task. Every integration fixture must use a temporary directory so repository and workspace files remain immutable.
