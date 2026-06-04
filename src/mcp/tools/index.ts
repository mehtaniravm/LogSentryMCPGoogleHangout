import { listServicesTool } from './listServices.js';
import { queryLogsTool } from './queryLogs.js';
import { getServiceHealthTool } from './getServiceHealth.js';
import { findAnomaliesTool } from './findAnomalies.js';
import { getErrorSummaryTool } from './getErrorSummary.js';
import type { Tool } from './types.js';

export { listServicesTool, queryLogsTool, getServiceHealthTool, findAnomaliesTool, getErrorSummaryTool };
export type { Tool, ToolDeps } from './types.js';

/** All read-only MCP tools, in a stable order. */
export const ALL_TOOLS: ReadonlyArray<Tool<unknown>> = [
  listServicesTool,
  queryLogsTool,
  getServiceHealthTool,
  findAnomaliesTool,
  getErrorSummaryTool,
];
