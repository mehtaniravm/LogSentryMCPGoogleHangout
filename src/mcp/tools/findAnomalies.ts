import { z } from 'zod';
import type { Tool } from './types.js';
import type { Anomaly } from '../../logging/types.js';
import { getThresholdsForService } from '../../config/thresholds.js';
import { runAllDetectors } from '../../anomaly/detectors.js';

const schema = z.object({
  service: z.string().optional(),
  windowMinutes: z.number().int().min(1).max(1440).optional(),
});

export const findAnomaliesTool: Tool<Anomaly[]> = {
  name: 'find_anomalies',
  description:
    'Run all anomaly detectors across one service (or the whole fleet) and return anomalies sorted by severity.',
  inputSchema: schema.shape,
  async handler(args, deps) {
    const input = schema.parse(args);
    const windowMinutes = input.windowMinutes ?? deps.defaultWindowMinutes;
    const services = input.service ? [input.service] : await deps.logging.listServices();

    const all: Anomaly[] = [];
    for (const service of services) {
      const th = getThresholdsForService(service, deps.config);
      const entries = await deps.logging.queryLogs({
        service,
        windowMinutes,
        limit: deps.maxLogsPerQuery,
      });
      all.push(...runAllDetectors(entries, th));
    }
    return all.sort((a, b) => b.severityScore - a.severityScore);
  },
};
