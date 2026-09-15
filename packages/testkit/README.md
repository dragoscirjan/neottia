# @neottia/testkit

Private test infrastructure for Neottia. This workspace is not published for user installation.

## Exported helpers

Repository discovery exports MCP entry paths and build checks for Memory, Issues, Design Docs, and Searchable. Use `requireSearchableDistBuilt` in live tests so the test fails instead of building inside the repository worktree.

Temporary fixture exports are `createConfigFixture`, `createTempProject`, `createTempIssueProject`, `createTempHarnessEnvironment`, `seedMemory`, `seedIssues`, `seedDesignDocs`, `CreateTempProjectOptions`, `CreateTempIssueProjectOptions`, `TempProject`, `TempIssueProject`, and `TempHarnessEnvironment`. `createConfigFixture` supplies isolated global and project files, profiles, environment values, explicit overrides, and two CWD routes for shared snapshot tests. `createTempHarnessEnvironment` puts project, home, and XDG roots beneath one disposable directory.

Adapter conformance exports are `assertHarnessAdapterConformance`, `resolveHarnessTarget`, `materializeProjectedFile`, and `materializeHostConfigPlan`. Materializers reject paths outside the temporary anchor and exist only for tests.

MCP configuration exports are `mcpServersDocument`, `writeMcpServersJsonFile`, `writeOpencodeMcpConfig`, `writeServersMcpConfig`, and `McpServerDefinition`. The generic MCP writer does not imply Pi support; Pi has no built-in MCP configuration.

Harness runner exports are `runPi`, `runOpencode`, `runPiWithModelFallback`, `runOpencodeWithModelFallback`, `piBin`, `piReady`, `binExists`, `opencodeReady`, `opencodeModel`, `openrouterApiKey`, `openrouterModelId`, `freeModelFallbackIds`, `resolveFreeOpenRouterModel`, `isTransientModelError`, `assertHarnessConclusive`, `assertHarnessSuccess`, and `HarnessRunResult`.

## Test tasks

`mise run test:harness` runs deterministic adapter and transport contracts. `mise run test:harness:live` is the opt-in live model acceptance task. Every integration fixture must use a temporary directory so repository and workspace files remain immutable.
