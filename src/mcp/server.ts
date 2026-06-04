import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ALL_TOOLS } from './tools/index.js';
import type { ToolDeps } from './tools/types.js';

/**
 * Build an McpServer with all read-only LogSentry tools registered. Each tool's
 * domain handler is wrapped so its result is returned as JSON text content;
 * thrown errors become a structured MCP error result rather than a crash.
 */
export function createMcpServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: 'logsentry', version: '0.1.0' });

  for (const tool of ALL_TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: unknown): Promise<CallToolResult> => {
        try {
          const result = await tool.handler(args, deps);
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Error in ${tool.name}: ${(err as Error).message}` }],
            isError: true,
          };
        }
      },
    );
  }

  return server;
}

/** Connect the server over stdio (local dev / Claude Desktop / MCP Inspector). */
export async function startStdio(deps: ToolDeps): Promise<void> {
  const server = createMcpServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Standalone stdio entry: `node dist/mcp/server.js` (MCP Inspector smoke test).
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const { loadEnv } = await import('../config/env.js');
  const { buildToolDeps } = await import('../runtime/clients.js');
  await startStdio(buildToolDeps(loadEnv()));
}
