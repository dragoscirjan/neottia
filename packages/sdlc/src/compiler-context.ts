import type { ResolvedConfigSnapshot } from '@neottia/config';
import { designDocsConfigContribution } from '@neottia/design-docs';
import { issueConfigContribution } from '@neottia/issues';
import {
  documentsCapabilityConfigContribution,
  issuesCapabilityConfigContribution,
  sourceControlCapabilityConfigContribution,
  type DocumentProvider,
  type IssueProvider,
  type LocalSourceControlProvider,
  type RemoteSourceControlProvider,
} from './config.js';

/** Stable causes for rejecting a resolved SDLC compiler context. */
export type SdlcConfigProblemCode = 'DOCUMENTS_MODULE_DISABLED' | 'ISSUES_MODULE_DISABLED' | 'WORKSPACES_REQUIRE_GIT';

/** One value-free semantic configuration problem. */
export interface SdlcConfigProblem {
  readonly code: SdlcConfigProblemCode;
  readonly path: readonly string[];
  readonly message: string;
}

/** Reports semantic conflicts between independently valid configuration shards. */
export class SdlcConfigError extends Error {
  readonly code = 'SDLC_CONFIG_INVALID';
  readonly problems: readonly SdlcConfigProblem[];

  constructor(problems: readonly SdlcConfigProblem[]) {
    const ordered = [...problems].sort(compareProblems).map(freezeProblem);
    super(`Invalid SDLC configuration: ${ordered.map((problem) => problem.message).join('; ')}`);
    this.name = 'SdlcConfigError';
    this.problems = Object.freeze(ordered);
  }
}

/** Provider selections consumed by the future prompt compiler. */
export interface SdlcCompilerContext {
  readonly issues: { readonly provider: IssueProvider };
  readonly documents: { readonly provider: DocumentProvider };
  readonly sourceControl: {
    readonly local: LocalSourceControlProvider;
    readonly remote:
      { readonly enabled: false } | { readonly enabled: true; readonly provider: RemoteSourceControlProvider };
    readonly workspaces: boolean;
  };
}

/** Builds immutable prompt-compiler input from one already resolved snapshot. */
export function createSdlcCompilerContext(snapshot: ResolvedConfigSnapshot): SdlcCompilerContext {
  const issues = snapshot.get(issuesCapabilityConfigContribution);
  const documents = snapshot.get(documentsCapabilityConfigContribution);
  const sourceControl = snapshot.get(sourceControlCapabilityConfigContribution);
  const problems: SdlcConfigProblem[] = [];

  if (issues.provider === 'filesystem' && !snapshot.get(issueConfigContribution).enabled) {
    problems.push({
      code: 'ISSUES_MODULE_DISABLED',
      path: ['modules', 'issues', 'enabled'],
      message: 'The Issues module must be enabled for the selected authority.',
    });
  }
  if (documents.provider === 'filesystem' && !snapshot.get(designDocsConfigContribution).enabled) {
    problems.push({
      code: 'DOCUMENTS_MODULE_DISABLED',
      path: ['modules', 'design_docs', 'enabled'],
      message: 'The Design Docs module must be enabled for the selected authority.',
    });
  }
  if (sourceControl.workspaces && sourceControl.local !== 'git') {
    problems.push({
      code: 'WORKSPACES_REQUIRE_GIT',
      path: ['capabilities', 'source_control', 'workspaces'],
      message: 'Workspaces are incompatible with the selected local source-control implementation.',
    });
  }
  if (problems.length > 0) throw new SdlcConfigError(problems);

  const remote =
    sourceControl.remote === false
      ? Object.freeze({ enabled: false as const })
      : Object.freeze({ enabled: true as const, provider: sourceControl.remote });
  return Object.freeze({
    documents: Object.freeze({ provider: documents.provider }),
    issues: Object.freeze({ provider: issues.provider }),
    sourceControl: Object.freeze({ local: sourceControl.local, remote, workspaces: sourceControl.workspaces }),
  });
}

/** Orders semantic problems independently of contribution access order. */
function compareProblems(left: SdlcConfigProblem, right: SdlcConfigProblem): number {
  return left.path.join('.').localeCompare(right.path.join('.')) || left.code.localeCompare(right.code);
}

/** Detaches and freezes one problem before exposing it to consumers. */
function freezeProblem(problem: SdlcConfigProblem): SdlcConfigProblem {
  return Object.freeze({ ...problem, path: Object.freeze([...problem.path]) });
}
