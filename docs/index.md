# Neottia

Neottia stores software delivery records in formats that people and AI tools can inspect. Use Memory for project facts and decisions, Issues for work tracking, and Design Docs for reviewed technical records. Searchable is a foundation package for applications that supply their own search, fetch, storage, grep, and answer services.

## Choose how to use Neottia

- Use a [native Pi or OpenCode extension](/harnesses/) when you want tools inside either supported host.
- Use a [generic MCP server](/mcp/) when your client can launch a stdio MCP process.
- Use a [TypeScript library](/get-started/) when you are building an application or adapter.

Read the [platform requirements](/get-started/requirements) before enabling a filesystem-backed capability.

## Availability

| Capability  | Library                | Native Pi | Native OpenCode | Generic MCP |
| ----------- | ---------------------- | --------- | --------------- | ----------- |
| Memory      | Yes                    | Yes       | Yes             | Yes         |
| Issues      | Yes                    | Yes       | Yes             | Yes         |
| Design Docs | Yes                    | Yes       | Yes             | Yes         |
| Searchable  | Injected services only | No        | No              | No          |

## Modules

The [module catalog](/reference/modules) accounts for all 18 published and private workspaces and defines each status label.

## Start a project

1. Check [runtime and filesystem requirements](/get-started/requirements).
2. Select a [delivery method](/get-started/).
3. Create the [shared configuration file](/get-started/configuration).
4. Complete a [first successful operation](/get-started/first-success).
5. Add the recommended [Git tracking and ignore rules](/guides/repository-files).
