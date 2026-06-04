import { pathToFileURL } from 'node:url';
import { loadEnv } from './config/env.js';
import { buildToolDeps } from './runtime/clients.js';
import { startStdio } from './mcp/server.js';
import { buildAppContext, createApp } from './server.js';

export const VERSION = '0.1.0';

/** Application entrypoint: stdio MCP server or the HTTP service per MCP_TRANSPORT. */
export async function main(): Promise<void> {
  const env = loadEnv();

  if (env.MCP_TRANSPORT === 'stdio') {
    const deps = buildToolDeps(env);
    await startStdio(deps);
    return;
  }

  const ctx = buildAppContext(env);
  const app = createApp(ctx);
  app.listen(env.PORT, () => {
    console.log(`LogSentry listening on :${env.PORT} (transport=${env.MCP_TRANSPORT})`);
  });
}

// Run when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exitCode = 1;
  });
}
