import { resolve } from 'node:path';

import { createConfigRegistry, resolveConfig, type ResolvedConfigSnapshot } from '@neottia/config';
import { designDocsConfigContribution } from '@neottia/design-docs';
import { issueConfigContribution } from '@neottia/issues';
import { memoryConfigContribution } from '@neottia/memory-core';
import {
  documentsCapabilityConfigContribution,
  forgeConnectionsConfigContribution,
  issuesCapabilityConfigContribution,
  sdlcRoleAssignmentsConfigContribution,
  sourceControlCapabilityConfigContribution,
} from '@neottia/sdlc';
import { searchableConfigContribution } from '@neottia/searchable-core';

import {
  assetInstallConfigContribution,
  harnessInstallConfigContribution,
  templateInstallConfigContribution,
} from './distribution.js';

export {
  assetInstallConfigContribution,
  assetInstallConfigPatchSchema,
  assetInstallConfigSchema,
  harnessInstallConfigContribution,
  harnessInstallConfigPatchSchema,
  harnessInstallConfigSchema,
  staticSkillConfigSchema,
  templateInstallConfigContribution,
  templateInstallConfigPatchSchema,
  templateInstallConfigSchema,
  templateSourceConfigSchema,
  type AssetInstallConfig,
  type HarnessInstallConfig,
  type TemplateInstallConfig,
} from './distribution.js';

/** Official contributions accepted by every Neottia host configuration. */
export const officialConfigContributions = Object.freeze([
  memoryConfigContribution,
  issueConfigContribution,
  designDocsConfigContribution,
  searchableConfigContribution,
  harnessInstallConfigContribution,
  assetInstallConfigContribution,
  templateInstallConfigContribution,
  forgeConnectionsConfigContribution,
  sdlcRoleAssignmentsConfigContribution,
  issuesCapabilityConfigContribution,
  documentsCapabilityConfigContribution,
  sourceControlCapabilityConfigContribution,
] as const);

/** Strict registry shared by Neottia's MCP and harness hosts. */
export const officialConfigRegistry = createConfigRegistry(officialConfigContributions);

/** Inputs for resolving one complete host configuration snapshot. */
export interface HostConfigSnapshotOptions {
  readonly cwd: string;
  readonly interactive: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly overrides?: Readonly<Record<string, unknown>>;
  readonly snapshot?: ResolvedConfigSnapshot;
}

/** Resolves all official modules once and derives non-interactive cache policy in memory. */
export function resolveHostConfigSnapshot(options: HostConfigSnapshotOptions): ResolvedConfigSnapshot {
  if (options.snapshot && (options.env || options.overrides)) {
    throw new TypeError('A supplied host snapshot cannot be combined with configuration source options.');
  }
  const declared =
    options.snapshot ??
    resolveConfig(officialConfigRegistry, {
      cwd: resolve(options.cwd),
      env: options.env ?? process.env,
      ...(options.overrides ? { overrides: options.overrides } : {}),
    });
  if (options.interactive) return declared;

  const modules: Record<string, unknown> = {};
  if (declared.get(memoryConfigContribution).cache.stale_policy === 'prompt') {
    modules['memory'] = { cache: { stale_policy: 'rebuild' } };
  }
  if (declared.get(issueConfigContribution).cache.stale_policy === 'prompt') {
    modules['issues'] = { cache: { stale_policy: 'rebuild' } };
  }
  if (declared.get(designDocsConfigContribution).cache.stale_policy === 'prompt') {
    modules['design_docs'] = { cache: { stale_policy: 'rebuild' } };
  }
  if (declared.get(searchableConfigContribution).cache.stale_policy === 'prompt') {
    modules['searchable'] = { cache: { stale_policy: 'rebuild' } };
  }
  return Object.keys(modules).length === 0
    ? declared
    : declared.derive({ modules }, 'non-interactive host stale-cache policy');
}
