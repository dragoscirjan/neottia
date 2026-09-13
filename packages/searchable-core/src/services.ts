import type { DeepReadonly } from '@neottia/config';
import type { SearchableConfig } from './config.js';
import type { SearchableDeadline } from './http.js';
import type { ResolvedSearchableToolInput, SearchableToolOutput } from './tool-contracts.js';

/** Invocation controls passed unchanged to caller-owned implementations. */
export interface SearchableOperationContext {
  readonly cwd: string;
  readonly config: DeepReadonly<SearchableConfig>;
  readonly signal?: AbortSignal;
  /** Absolute Unix epoch deadline shared by all work in one tool call. */
  readonly deadline?: number;
  /** Internal monotonic counterpart shared by runtime, storage, and migration stages. */
  readonly transportDeadline?: SearchableDeadline;
  /** Interactive confirmation used only when a disposable cache is stale. */
  readonly onStaleCache?: () => boolean | Promise<boolean>;
}

/** Service contract implemented by the concrete runtime or a caller-owned replacement. */
export interface SearchableServices {
  readonly search: (
    input: ResolvedSearchableToolInput<'web_search'>,
    context: SearchableOperationContext,
  ) => Promise<SearchableToolOutput<'web_search'>>;
  readonly fetch: (
    input: ResolvedSearchableToolInput<'web_fetch'>,
    context: SearchableOperationContext,
  ) => Promise<SearchableToolOutput<'web_fetch'>>;
  readonly stash: (
    input: ResolvedSearchableToolInput<'web_stash'>,
    context: SearchableOperationContext,
  ) => Promise<SearchableToolOutput<'web_stash'>>;
  readonly grep: (
    input: ResolvedSearchableToolInput<'web_grep'>,
    context: SearchableOperationContext,
  ) => Promise<SearchableToolOutput<'web_grep'>>;
  readonly ask: (
    input: ResolvedSearchableToolInput<'web_ask'>,
    context: SearchableOperationContext,
  ) => Promise<SearchableToolOutput<'web_ask'>>;
}
