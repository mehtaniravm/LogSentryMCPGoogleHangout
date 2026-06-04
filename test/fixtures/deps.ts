import { vi } from 'vitest';
import type { CloudLogging, QueryLogsOptions } from '../../src/logging/cloudLogging.js';
import type { LogEntry } from '../../src/logging/types.js';
import type { ToolDeps } from '../../src/mcp/tools/types.js';
import { loadThresholds } from '../../src/config/thresholds.js';

/** A fake CloudLogging whose responses are driven by callbacks for tests. */
export function fakeLogging(opts: {
  queryLogs?: (o: QueryLogsOptions) => LogEntry[];
  listServices?: () => string[];
}): CloudLogging {
  return {
    queryLogs: vi.fn(async (o: QueryLogsOptions) => opts.queryLogs?.(o) ?? []),
    listServices: vi.fn(async () => opts.listServices?.() ?? []),
  };
}

/** Build ToolDeps wrapping a fake logging layer and the real thresholds config. */
export function fakeDeps(logging: CloudLogging): ToolDeps {
  return {
    logging,
    config: loadThresholds(),
    defaultWindowMinutes: 5,
    maxLogsPerQuery: 500,
  };
}
