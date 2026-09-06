import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Writers for the MCP server declarations each harness understands.
 * Shapes verified against official documentation:
 * - generic `mcpServers` JSON: Claude Code (.mcp.json), Kiro (.kiro/settings/mcp.json)
 * - OpenCode: `opencode.json` -> mcp -> { type: 'local', command: [...], environment }
 * - VS Code: .vscode/mcp.json -> { servers: { ... } } (generic shape, different root key)
 */

export interface McpServerDefinition {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

/** Shape used by Claude Code, Kiro, pi, and others: `{ mcpServers: { <name>: {command,args,env} } }`. */
export function mcpServersDocument(servers: Record<string, McpServerDefinition>): object {
  return {
    mcpServers: Object.fromEntries(
      Object.entries(servers).map(([name, server]) => [
        name,
        { command: server.command, args: [...server.args], ...(server.env ? { env: { ...server.env } } : {}) },
      ]),
    ),
  };
}

/** Writes a generic `mcpServers` JSON config file and returns its path. */
export function writeMcpServersJsonFile(filePath: string, server: McpServerDefinition, name = 'memory'): string {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(mcpServersDocument({ [name]: server }), null, 2)}\n`, 'utf8');
  return filePath;
}

/** Writes a VS Code–style MCP config (`{ servers: … }`) and returns its path. */
export function writeServersMcpConfig(filePath: string, server: McpServerDefinition, name = 'memory'): string {
  mkdirSync(dirname(filePath), { recursive: true });
  const document = {
    servers: {
      [name]: { command: server.command, args: [...server.args], ...(server.env ? { env: { ...server.env } } : {}) },
    },
  };
  writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return filePath;
}

/** Writes an OpenCode project config registering a local MCP server. */
export function writeOpencodeMcpConfig(cwd: string, server: McpServerDefinition, name = 'memory'): string {
  const path = join(cwd, 'opencode.json');
  const document = {
    $schema: 'https://opencode.ai/config.json',
    mcp: {
      [name]: {
        type: 'local',
        command: [server.command, ...server.args],
        ...(server.env ? { environment: { ...server.env } } : {}),
        enabled: true,
      },
    },
  };
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return path;
}
