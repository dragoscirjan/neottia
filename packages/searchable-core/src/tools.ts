import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { loadSearchableConfig, type SearchableConfig, type SearchableConfigInput } from './config.js';
import { SearchableError } from './errors.js';
import { asRedactedSearchableError } from './redaction.js';
import type { SearchableOperationContext, SearchableServices } from './services.js';
import {
  searchableToolSchemas,
  type ResolvedSearchableToolInput,
  type SearchableToolInput,
  type SearchableToolName,
  type SearchableToolOutput,
} from './tool-contracts.js';

/** Per-invocation host state supplied by future MCP, Pi, and OpenCode adapters. */
export interface SearchableToolContext {
  readonly cwd: string;
  readonly services: SearchableServices;
  readonly signal?: AbortSignal;
  readonly configOverrides?: Partial<SearchableConfigInput>;
}

/** Host-neutral executable definition consumed unchanged by every adapter. */
export interface SearchableToolDefinition {
  readonly name: SearchableToolName;
  readonly description: string;
  readonly inputSchema: z.ZodObject;
  readonly outputSchema: z.ZodType;
  readonly run: (context: SearchableToolContext, input: unknown) => Promise<unknown>;
}

/** Builds a validating, bounded definition around one caller-owned service method. */
function makeTool<Name extends SearchableToolName>(
  name: Name,
  description: string,
  handler: (
    services: SearchableServices,
    input: ResolvedSearchableToolInput<Name>,
    context: SearchableOperationContext,
  ) => Promise<SearchableToolOutput<Name>>,
): SearchableToolDefinition {
  const inputSchema = searchableToolSchemas[name].input;
  const outputSchema = searchableToolSchemas[name].output;
  return {
    name,
    description,
    inputSchema,
    outputSchema,
    async run(context, input) {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success)
        throw new SearchableError(
          'validation',
          'TOOL_INPUT_INVALID',
          `Invalid ${name} input: ${formatIssues(parsed.error)}`,
          parsed.error.issues.map((issue) => issue.path.join('.')),
        );
      const config = loadSearchableConfig(context.cwd, context.configOverrides);
      try {
        assertNotCancelled(context.signal);
        const resolvedInput = resolveInputDefaults(name, parsed.data as SearchableToolInput<Name>, config);
        assertInputBounds(name, resolvedInput, config);
        const operation = {
          cwd: context.cwd,
          config,
          ...(context.signal === undefined ? {} : { signal: context.signal }),
        };
        const output = await handler(context.services, resolvedInput, operation);
        assertNotCancelled(context.signal);
        const validated = outputSchema.safeParse(output);
        if (!validated.success)
          throw new SearchableError(
            'validation',
            'TOOL_OUTPUT_INVALID',
            `Invalid ${name} service output: ${formatIssues(validated.error)}`,
            validated.error.issues.map((issue) => issue.path.join('.')),
          );
        assertOutputBounds(name, validated.data, config);
        return validated.data;
      } catch (error: unknown) {
        throw asRedactedSearchableError(error, config);
      }
    },
  };
}

/** The single shared executable registry for the five upstream-compatible names. */
export const SEARCHABLE_TOOLS: readonly SearchableToolDefinition[] = [
  makeTool('web_search', 'Search the web through an injected provider service.', (services, input, context) =>
    services.search(input, context),
  ),
  makeTool('web_fetch', 'Fetch and extract an HTTP(S) page through an injected service.', (services, input, context) =>
    services.fetch(input, context),
  ),
  makeTool(
    'web_stash',
    'Persist extracted page content through an injected storage service.',
    (services, input, context) => services.stash(input, context),
  ),
  makeTool('web_grep', 'Search stashed pages through an injected storage service.', (services, input, context) =>
    services.grep(input, context),
  ),
  makeTool('web_ask', 'Answer from stashed context through an injected ask service.', (services, input, context) =>
    services.ask(input, context),
  ),
];

/** Finds one canonical Searchable definition by its external tool name. */
export function findSearchableTool(name: string): SearchableToolDefinition | undefined {
  return SEARCHABLE_TOOLS.find((tool) => tool.name === name);
}

/** Resolves omitted public fields only after the config precedence chain is complete. */
function resolveInputDefaults<Name extends SearchableToolName>(
  name: Name,
  input: SearchableToolInput<Name>,
  config: SearchableConfig,
): ResolvedSearchableToolInput<Name> {
  const value = input as Record<string, unknown>;
  let resolved: Record<string, unknown> = value;
  if (name === 'web_search')
    resolved = {
      ...value,
      provider: value['provider'] ?? config.search.provider,
      limit: value['limit'] ?? config.search.limit,
    };
  else if (name === 'web_grep') resolved = { ...value, limit: value['limit'] ?? config.grep.limit };
  else if (name === 'web_ask') resolved = { ...value, limit: value['limit'] ?? config.ask.limit };
  return resolved as ResolvedSearchableToolInput<Name>;
}

/** Enforces configured UTF-8 and result-count limits before calling a service. */
function assertInputBounds(name: SearchableToolName, input: unknown, config: SearchableConfig): void {
  const value = input as Record<string, unknown>;
  if (typeof value['query'] === 'string') assertBytes('query', value['query'], config.security.limits.max_query_bytes);
  if (typeof value['question'] === 'string')
    assertBytes('question', value['question'], config.security.limits.max_query_bytes);
  if (typeof value['url'] === 'string') assertBytes('url', value['url'], config.security.limits.max_url_bytes);
  if (typeof value['title'] === 'string') assertBytes('title', value['title'], config.security.limits.max_title_bytes);
  if (typeof value['content'] === 'string')
    assertBytes('content', value['content'], config.security.limits.max_content_bytes);
  if (typeof value['excerpt'] === 'string')
    assertBytes('excerpt', value['excerpt'], config.security.limits.max_content_bytes);
  if (typeof value['siteName'] === 'string')
    assertBytes('siteName', value['siteName'], config.security.limits.max_title_bytes);
  if (typeof value['limit'] === 'number' && value['limit'] > config.security.limits.max_results)
    throw limitError('limit', config.security.limits.max_results, name);
}

/** Enforces configured field and aggregate bounds after output schema validation. */
function assertOutputBounds(name: SearchableToolName, output: unknown, config: SearchableConfig): void {
  const value = output as Record<string, unknown>;
  const rows = Array.isArray(value['results']) ? value['results'] : [value];
  if (Array.isArray(value['results']) && value['results'].length > config.security.limits.max_results)
    throw limitError('results', config.security.limits.max_results, name);
  for (const row of rows) assertOutputRecord(row as Record<string, unknown>, config);
  if (Array.isArray(value['contextUrls'])) {
    if (value['contextUrls'].length > config.security.limits.max_results)
      throw limitError('contextUrls', config.security.limits.max_results, name);
    for (const url of value['contextUrls'])
      if (typeof url === 'string') assertBytes('contextUrls', url, config.security.limits.max_url_bytes);
  }
  const serializedBytes = Buffer.byteLength(JSON.stringify(output), 'utf8');
  if (serializedBytes > config.security.limits.max_result_bytes)
    throw limitError('serialized output', config.security.limits.max_result_bytes, name, serializedBytes);
}

/** Applies configured bounds to known object-root output string fields. */
function assertOutputRecord(value: Record<string, unknown>, config: SearchableConfig): void {
  for (const field of ['url'] as const)
    if (typeof value[field] === 'string') assertBytes(field, value[field], config.security.limits.max_url_bytes);
  for (const field of ['title', 'siteName'] as const)
    if (typeof value[field] === 'string') assertBytes(field, value[field], config.security.limits.max_title_bytes);
  for (const field of ['content', 'excerpt', 'snippet', 'answer'] as const)
    if (typeof value[field] === 'string') assertBytes(field, value[field], config.security.limits.max_content_bytes);
}

/** Rejects a UTF-8 string that exceeds a configured byte boundary. */
function assertBytes(field: string, value: string, maximum: number): void {
  const actual = Buffer.byteLength(value, 'utf8');
  if (actual > maximum) throw limitError(field, maximum, undefined, actual);
}

/** Constructs one stable resource-limit error without embedding rejected data. */
function limitError(field: string, maximum: number, tool?: string, actual?: number): SearchableError {
  return new SearchableError(
    'resource_limit',
    'RESOURCE_LIMIT_EXCEEDED',
    `${field} exceeds the configured limit.`,
    [field],
    { maximum, ...(actual === undefined ? {} : { actual }), ...(tool === undefined ? {} : { tool }) },
  );
}

/** Fails promptly before or after a service when the host cancels the call. */
function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new SearchableError('cancelled', 'OPERATION_CANCELLED', 'Searchable operation was cancelled.');
}

/** Formats validation locations and messages without rejected values. */
function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');
}
