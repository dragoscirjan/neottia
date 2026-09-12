import type { SearchableConfig } from './config.js';
import type { ResolvedSearchableToolInput, SearchableToolOutput } from './tool-contracts.js';

/** Invocation controls passed unchanged to caller-owned implementations. */
export interface SearchableOperationContext {
  readonly cwd: string;
  readonly config: SearchableConfig;
  readonly signal?: AbortSignal;
}

/** Caller-owned service seams; this foundation never constructs or disposes them. */
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
