import type { LogEntry, ServiceHealth, Severity } from '../logging/types.js';
import type { ServiceThresholds } from '../config/thresholds.js';
import { percentile } from './detectors.js';

const ERROR_SEVERITIES: ReadonlySet<Severity> = new Set<Severity>([
  'ERROR',
  'CRITICAL',
  'ALERT',
  'FATAL',
]);

/**
 * Summarize a window of one service's logs into a ServiceHealth, deriving
 * `status` from the service's thresholds:
 *  - silent:   fewer logs than silence.expected_min_logs
 *  - critical: any FATAL over max_fatal, or error rate >= 2x the error threshold
 *  - degraded: error rate over the threshold (volume permitting), or p99 over latency threshold
 *  - healthy:  otherwise
 */
export function computeHealth(
  service: string,
  entries: LogEntry[],
  windowMinutes: number,
  th: ServiceThresholds,
): ServiceHealth {
  const totalLogs = entries.length;
  const errorCount = entries.filter((e) => ERROR_SEVERITIES.has(e.severity)).length;
  const fatalCount = entries.filter((e) => e.severity === 'FATAL').length;
  const errorPct = totalLogs === 0 ? 0 : Math.round((errorCount / totalLogs) * 1000) / 10;

  const latencies = entries
    .filter((e) => typeof e.latencyMs === 'number')
    .map((e) => e.latencyMs as number);
  const p99 = latencies.length > 0 ? percentile(latencies, 99) : undefined;

  const volumeOk = totalLogs >= th.error_rate.min_volume;
  let status: ServiceHealth['status'];
  if (totalLogs < th.silence.expected_min_logs) {
    status = 'silent';
  } else if (
    fatalCount > th.fatal.max_fatal ||
    (volumeOk && errorPct >= th.error_rate.max_error_pct * 2)
  ) {
    status = 'critical';
  } else if (
    (volumeOk && errorPct > th.error_rate.max_error_pct) ||
    (p99 !== undefined && p99 > th.latency.p99_ms_threshold)
  ) {
    status = 'degraded';
  } else {
    status = 'healthy';
  }

  const health: ServiceHealth = {
    service,
    windowMinutes,
    totalLogs,
    errorCount,
    fatalCount,
    errorPct,
    status,
  };
  if (p99 !== undefined) health.p99LatencyMs = p99;
  return health;
}
