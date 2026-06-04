import { z } from 'zod';
import type { Tool } from './types.js';
import type { ServiceHealth } from '../../logging/types.js';
import { getThresholdsForService } from '../../config/thresholds.js';
import { computeHealth } from '../../anomaly/health.js';

const schema = z.object({
  service: z.string().min(1),
  windowMinutes: z.number().int().min(1).max(1440).optional(),
});

export const getServiceHealthTool: Tool<ServiceHealth> = {
  name: 'get_service_health',
  description:
    'Compute health (log volume, error %, fatal count, p99 latency, status) for one service over a window.',
  inputSchema: schema.shape,
  async handler(args, deps) {
    const input = schema.parse(args);
    const windowMinutes = input.windowMinutes ?? deps.defaultWindowMinutes;
    const th = getThresholdsForService(input.service, deps.config);
    const entries = await deps.logging.queryLogs({
      service: input.service,
      windowMinutes,
      limit: deps.maxLogsPerQuery,
    });
    return computeHealth(input.service, entries, windowMinutes, th);
  },
};
