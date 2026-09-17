import type { SdlcCompilerContext, SdlcForgeConnectionContext } from './compiler-context.js';
import { FORGE_SUPPORT_DECLARATIONS, type ForgeCapability, type ForgeProvider } from './forge-support.js';
import { createSdlcInstructionPack, type SdlcInstructionPack } from './instructions.js';

const FORGE_INSTRUCTION_VERSION = '1.0.0';

/** Materializes only the selected forge fragments from validated compiler context. */
export function createForgeInstructionPacks(context: SdlcCompilerContext): readonly SdlcInstructionPack[] {
  return Object.freeze(
    context.forges.flatMap((connection) =>
      connection.capabilities.map((capability) =>
        createSdlcInstructionPack({
          id: instructionId(connection.provider, capability),
          slot: capability === 'remote-source-control' ? 'source-control.remote' : capability,
          provider: connection.provider,
          version: FORGE_INSTRUCTION_VERSION,
          content: instructionContent(connection, capability),
        }),
      ),
    ),
  );
}

/** Creates the stable fragment identity for one forge capability. */
function instructionId(provider: ForgeProvider, capability: ForgeCapability): string {
  if (capability === 'remote-source-control') return `neottia.source-control.remote.${provider}`;
  return `neottia.${capability}.${provider}`;
}

/** Renders one provider-specific fragment without changing canonical lifecycle templates. */
function instructionContent(connection: SdlcForgeConnectionContext, capability: ForgeCapability): string {
  const header = `Use ${providerName(connection.provider)} at ${connection.baseUrl}. Read credentials only from the ${connection.credentialEnvironment} environment variable; never print, persist, or copy its value into tracked evidence.`;
  const guidance = providerCapabilityGuidance(connection, capability);
  const mcp = mcpGuidance(connection, capability);
  const safety = mutationSafety();
  return `${header}\n\n${guidance}${mcp}\n\n${safety}\n`;
}

/** Returns commands and supported operations grounded in each provider's documented interfaces. */
function providerCapabilityGuidance(connection: SdlcForgeConnectionContext, capability: ForgeCapability): string {
  const provider = connection.provider;
  if (provider === 'github') {
    if (capability === 'issues') {
      return 'Use the documented `gh issue` command group for issue reads, creation, comments, edits, and closure. Preserve the repository, issue number, URL, and resulting state as evidence.';
    }
    if (capability === 'documents') {
      return 'GitHub wikis are Git-backed. Obtain the wiki clone URL from GitHub, read before editing, use local Git for the wiki repository, and keep wiki commits separate from product-source commits. Do not substitute issues or repository files for a configured wiki.';
    }
    return 'Use local Git for fetch and push. Use the documented `gh pr`, `gh run`, and `gh release` command groups for pull requests, review state, Actions evidence, and releases. A successful push does not authorize pull-request merge, and preparing a release does not authorize publication.';
  }
  if (provider === 'gitlab') {
    if (capability === 'issues') {
      return 'Use the documented `glab issue` command group for issue reads and mutations. Preserve the project path, issue IID, URL, and resulting state as evidence.';
    }
    if (capability === 'documents') {
      return 'GitLab wikis are Git-backed. Obtain the wiki clone URL from GitLab, read before editing, use local Git for the wiki repository, and keep wiki commits separate from product-source commits. Do not substitute issues or repository files for a configured wiki.';
    }
    return 'Use local Git for fetch and push. Use the documented `glab mr`, `glab ci`, and `glab release` command groups for merge requests, review state, pipeline evidence, and releases. A successful push does not authorize merge, and preparing a release does not authorize publication.';
  }
  if (capability === 'issues') {
    return `The documented \`${provider}\` binary is an administrative server CLI, not an end-user issue client. Use only the configured MCP service for issue reads and mutations. Preserve repository identity, issue number, URL, and resulting state as evidence.`;
  }
  return `Use local Git only for fetch and push. The documented \`${provider}\` binary is an administrative server CLI and must not be used for pull requests, review, CI, or releases. Use only the configured MCP service for those forge objects. A successful push does not authorize merge, and preparing a release does not authorize publication.`;
}

/** Adds capability-specific MCP selection and bounded availability checks. */
function mcpGuidance(connection: SdlcForgeConnectionContext, capability: ForgeCapability): string {
  const service =
    capability === 'remote-source-control' ? connection.mcp.remoteSourceControl : connection.mcp[capability];
  if (service === undefined) return '';
  const cli = FORGE_SUPPORT_DECLARATIONS[connection.provider].cli?.command;
  const alternative =
    capability === 'documents' ? ' or local Git' : cli === undefined ? '' : ` or the documented \`${cli}\` CLI`;
  return `\n\nThe configured MCP server is \`${service.server}\`, backed by the \`${service.command}\` command. Before mutation, verify read-only that this server is registered and exposes the required operation. If registration or the operation is missing, stop and report how to configure it; do not guess a tool. The MCP server${alternative} is a candidate, not permission to mutate.`;
}

/** Encodes the no-fallback mutation rule shared by every forge fragment. */
function mutationSafety(): string {
  return 'Before each mutation, perform non-mutating availability and access checks, then choose exactly one available tool for that operation. After sending a mutation, never retry the same mutation through another tool, including after a timeout or ambiguous response. Verify with the chosen tool; if the outcome cannot be established, stop and reconcile durable evidence. Merge and release publication always require separate explicit authorization.';
}

/** Returns the provider's user-facing product name. */
function providerName(provider: ForgeProvider): string {
  if (provider === 'github') return 'GitHub';
  if (provider === 'gitlab') return 'GitLab';
  if (provider === 'gitea') return 'Gitea';
  return 'Forgejo';
}
