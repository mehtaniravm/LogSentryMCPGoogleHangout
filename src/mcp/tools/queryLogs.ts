import { z } from 'zod';
import type { Tool } from './types.js';
import type { LogEntry } from '../../logging/types.js';

const SEVERITIES = [
  'DEBUG',
  'INFO',
  'NOTICE',
  'WARN',
  'ERROR',
  'CRITICAL',
  'ALERT',
  'FATAL',
] as const;

const schema = z.object({
  service: z.string().optional(),
  minSeverity: z.enum(SEVERITIES).optional(),
  windowMinutes: z.number().int().min(1).max(1440).default(5),
  // Hard cap at 500 to protect cost/latency (spec §4.4).
  limit: z.number().int().min(1).max(500).optional(),
  textFilter: z.string().optional(),
});

export const queryLogsTool: Tool<LogEntry[]> = {
  name: 'query_logs',
  description:
    'Query recent logs with optional service, minimum severity, time window (1-1440 min), text filter, and limit (<=500).',
  inputSchema: schema.shape,
  async handler(args, deps) {
    const input = schema.parse(args);
    const limit = Math.min(input.limit ?? deps.maxLogsPerQuery, deps.maxLogsPerQuery);
    return deps.logging.queryLogs({
      ...(input.service !== undefined ? { service: input.service } : {}),
      ...(input.minSeverity !== undefined ? { minSeverity: input.minSeverity } : {}),
      windowMinutes: input.windowMinutes,
      limit,
      ...(input.textFilter !== undefined ? { textFilter: input.textFilter } : {}),
    });
  },
};
