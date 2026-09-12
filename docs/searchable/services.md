# Implement Searchable foundation services

> Searchable is foundation-only. Your application owns every service and its cleanup.

Each method receives resolved input and one `SearchableOperationContext` containing `cwd`, resolved `config`, and optional `signal`:

```ts
export interface SearchableServices {
  search(
    input: ResolvedSearchableToolInput<"web_search">,
    context: SearchableOperationContext,
  ): Promise<SearchableToolOutput<"web_search">>;
  fetch(
    input: ResolvedSearchableToolInput<"web_fetch">,
    context: SearchableOperationContext,
  ): Promise<SearchableToolOutput<"web_fetch">>;
  stash(
    input: ResolvedSearchableToolInput<"web_stash">,
    context: SearchableOperationContext,
  ): Promise<SearchableToolOutput<"web_stash">>;
  grep(
    input: ResolvedSearchableToolInput<"web_grep">,
    context: SearchableOperationContext,
  ): Promise<SearchableToolOutput<"web_grep">>;
  ask(
    input: ResolvedSearchableToolInput<"web_ask">,
    context: SearchableOperationContext,
  ): Promise<SearchableToolOutput<"web_ask">>;
}
```

The checked example implements and invokes every method without network access:

<<< ../examples/searchable-mock.ts

Call `await runSearchableMock()` and inspect the printed search, fetch, stash, grep, and ask results.

A production implementation must enforce request and overall deadlines, stop streamed bodies at byte limits, reject private or unsafe network destinations, apply storage quotas, define tenant ownership, honor cancellation during work, and close network, database, and model resources. Configuration values provide policy inputs but no implementation.
