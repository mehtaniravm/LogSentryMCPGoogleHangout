import type { ZodRawShape } from 'zod';
import type { CloudLogging } from '../../logging/cloudLogging.js';
import type { ThresholdsConfig } from '../../config/thresholds.js';

/** Dependencies injected into every tool handler so all I/O is mockable. */
export interface ToolDeps {
  logging: CloudLogging;
  config: ThresholdsConfig;
  defaultWindowMinutes: number;
  maxLogsPerQuery: number;
}

/**
 * A read-only MCP tool. The domain `handler` is kept separate from transport
 * wrapping so it can be unit-tested directly. `handler` parses `args` with the
 * tool's zod schema and throws ZodError on invalid input.
 */
export interface Tool<Result> {
  name: string;
  description: string;
  /** zod raw shape consumed by McpServer.registerTool for client-facing schema. */
  inputSchema: ZodRawShape;
  handler(args: unknown, deps: ToolDeps): Promise<Result>;
}
