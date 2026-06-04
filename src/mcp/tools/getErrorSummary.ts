import { z } from 'zod';
import type { Tool } from './types.js';
import type { LogEntry, Severity } from '../../logging/types.js';

const ERROR_SEVERITIES: ReadonlySet<Severity> = new Set<Severity>([
  'ERROR',
  'CRITICAL',
  'ALERT',
  'FATAL',
]);

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HEX_RE = /\b0x[0-9a-f]+\b/gi;
const NUM_RE = /\d+/g;

/**
 * Normalize a log message into a signature by replacing UUIDs, hex, and digits
 * with placeholders so similar errors cluster. E.g. "NPE at line 42" and
 * "NPE at line 87" both become "NPE at line #".
 */
export function normalizeMessage(message: string): string {
  return message
    .replace(UUID_RE, '<uuid>')
    .replace(HEX_RE, '<hex>')
    .replace(NUM_RE, '#')
    .trim();
}

export interface ErrorSignature {
  signature: string;
  count: number;
  sample: string;
}

const schema = z.object({
  service: z.string().optional(),
  windowMinutes: z.number().int().min(1).max(1440).optional(),
});

export const getErrorSummaryTool: Tool<ErrorSignature[]> = {
  name: 'get_error_summary',
  description:
    'Group ERROR/FATAL messages into normalized signatures with counts, sorted by frequency.',
  inputSchema: schema.shape,
  async handler(args, deps) {
    const input = schema.parse(args);
    const windowMinutes = input.windowMinutes ?? deps.defaultWindowMinutes;
    const entries: LogEntry[] = await deps.logging.queryLogs({
      ...(input.service !== undefined ? { service: input.service } : {}),
      minSeverity: 'ERROR',
      windowMinutes,
      limit: deps.maxLogsPerQuery,
    });

    const groups = new Map<string, ErrorSignature>();
    for (const e of entries) {
      if (!ERROR_SEVERITIES.has(e.severity)) continue;
      const sig = normalizeMessage(e.message);
      const existing = groups.get(sig);
      if (existing) {
        existing.count += 1;
      } else {
        groups.set(sig, { signature: sig, count: 1, sample: e.message });
      }
    }
    return [...groups.values()].sort((a, b) => b.count - a.count);
  },
};
