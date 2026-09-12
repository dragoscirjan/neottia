# Issues MCP server

`@neottia/issues-mcp` requires Node.js 22.16 or newer and the [filesystem platform requirements](/get-started/requirements). Launch it in the project directory:

```sh
pnpm dlx @neottia/issues-mcp
```

Enable `skills.issues`, call `tools/list`, and verify the 17 names in the [Issues tool reference](/issues/tools). Run the [first issue call](/get-started/first-success#create-an-issue) and inspect `.neottia/issues/<id>.yml`.

The server fixes CWD when created. It is non-interactive, forwards MCP cancellation, and clears the tool context when `server.close()` runs. Successful object results use `structuredContent`. Errors serialize a structured JSON object into text but do not set `structuredContent`.

`createIssueServer({cwd, name, version, resolver})` embeds the server. The default resolver comes from `@neottia/issues-design-docs`; pass a custom resolver only when your application owns reference resolution. See [composition](/issues/design-docs).

For stale revisions, fetch the issue again and retry with its new revision. For stale cache under `fail`, run `issue_validate`. Correct invalid or disabled configuration before retrying.
