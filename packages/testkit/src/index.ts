export {
  designDocsMcpEntry,
  ensureDesignDocsDistBuilt,
  ensureIssuesDistBuilt,
  ensureMemoryDistBuilt,
  ensureSearchableDistBuilt,
  issuesMcpEntry,
  memoryMcpEntry,
  requireSearchableDistBuilt,
  searchableMcpEntry,
  repoRoot,
} from './repo.js';

export {
  createConfigFixture,
  type ConfigFixture,
  type ConfigFixtureModules,
  type CreateConfigFixtureOptions,
} from './config-fixture.js';

export {
  createTempIssueProject,
  createTempProject,
  seedDesignDocs,
  seedIssues,
  seedMemory,
  type CreateTempIssueProjectOptions,
  type CreateTempProjectOptions,
  type TempIssueProject,
  type TempProject,
} from './temp-project.js';

export {
  assertHarnessAdapterConformance,
  createTempHarnessEnvironment,
  materializeHostConfigPlan,
  materializeProjectedFile,
  resolveHarnessTarget,
  type TempHarnessEnvironment,
} from './harness-adapter.js';

export {
  mcpServersDocument,
  writeMcpServersJsonFile,
  writeOpencodeMcpConfig,
  writeServersMcpConfig,
  type McpServerDefinition,
} from './mcp-config.js';

export {
  assertHarnessConclusive,
  assertHarnessSuccess,
  binExists,
  piBin,
  piReady,
  runPi,
  opencodeReady,
  opencodeModel,
  openrouterApiKey,
  freeModelFallbackIds,
  isTransientModelError,
  openrouterModelId,
  resolveFreeOpenRouterModel,
  runOpencode,
  runOpencodeWithModelFallback,
  runPiWithModelFallback,
  type HarnessRunResult,
} from './runners.js';
