import type { Anomaly, LogEntry, Severity } from '../logging/types.js';
import type { ServiceThresholds } from '../config/thresholds.js';
import { scoreAnomaly } from './scoring.js';

const ERROR_SEVERITIES: ReadonlySet<Severity> = new Set<Severity>([
  'ERROR',
  'CRITICAL',
  'ALERT',
  'FATAL',
]);

const isError = (e: LogEntry): boolean => ERROR_SEVERITIES.has(e.severity);
const isFatal = (e: LogEntry): boolean => e.severity === 'FATAL';

const serviceOf = (entries: LogEntry[]): string => entries[0]?.service ?? 'unknown';

/** Up to `n` representative messages from the given entries. */
function samples(entries: LogEntry[], n = 3): string[] {
  return entries.slice(0, n).map((e) => e.message);
}

/** Nearest-rank percentile of a numeric array (0 < p <= 100). */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx] as number;
}

/** Finalize an anomaly by attaching its deterministic severity score. */
function finalize(a: Omit<Anomaly, 'severityScore'>, th: ServiceThresholds): Anomaly {
  const full: Anomaly = { ...a, severityScore: 0 };
  full.severityScore = scoreAnomaly(full, th.severity_weights);
  return full;
}

export function detectErrorRate(entries: LogEntry[], th: ServiceThresholds): Anomaly | null {
  const total = entries.length;
  if (total < th.error_rate.min_volume) return null;
  const errors = entries.filter(isError);
  const pct = (errors.length / total) * 100;
  if (pct <= th.error_rate.max_error_pct) return null;
  return finalize(
    {
      service: serviceOf(entries),
      type: 'error_rate',
      detail: `${errors.length}/${total} logs are errors (${pct.toFixed(1)}%)`,
      observed: Math.round(pct * 10) / 10,
      threshold: th.error_rate.max_error_pct,
      sampleMessages: samples(errors),
    },
    th,
  );
}

export function detectLatency(entries: LogEntry[], th: ServiceThresholds): Anomaly | null {
  const withLatency = entries.filter((e) => typeof e.latencyMs === 'number');
  if (withLatency.length === 0) return null;
  const p99 = percentile(
    withLatency.map((e) => e.latencyMs as number),
    99,
  );
  if (p99 <= th.latency.p99_ms_threshold) return null;
  const slowest = [...withLatency].sort((a, b) => (b.latencyMs ?? 0) - (a.latencyMs ?? 0));
  return finalize(
    {
      service: serviceOf(entries),
      type: 'latency',
      detail: `p99 latency ${p99}ms exceeds ${th.latency.p99_ms_threshold}ms`,
      observed: p99,
      threshold: th.latency.p99_ms_threshold,
      sampleMessages: samples(slowest),
    },
    th,
  );
}

export function detectErrorBurst(entries: LogEntry[], th: ServiceThresholds): Anomaly | null {
  const errors = entries.filter(isError);
  if (errors.length < th.error_burst.max_errors) return null;
  return finalize(
    {
      service: serviceOf(entries),
      type: 'error_burst',
      detail: `${errors.length} errors in window (>= ${th.error_burst.max_errors})`,
      observed: errors.length,
      threshold: th.error_burst.max_errors,
      sampleMessages: samples(errors),
    },
    th,
  );
}

export function detectFatal(entries: LogEntry[], th: ServiceThresholds): Anomaly | null {
  const fatals = entries.filter(isFatal);
  if (fatals.length <= th.fatal.max_fatal) return null;
  return finalize(
    {
      service: serviceOf(entries),
      type: 'fatal',
      detail: `${fatals.length} FATAL log(s) (> ${th.fatal.max_fatal})`,
      observed: fatals.length,
      threshold: th.fatal.max_fatal,
      sampleMessages: samples(fatals),
    },
    th,
  );
}

export function detectSilence(entries: LogEntry[], th: ServiceThresholds): Anomaly | null {
  const total = entries.length;
  if (total >= th.silence.expected_min_logs) return null;
  return finalize(
    {
      service: serviceOf(entries),
      type: 'silence',
      detail: `only ${total} logs in window (expected >= ${th.silence.expected_min_logs}); service may be down`,
      observed: total,
      threshold: th.silence.expected_min_logs,
      sampleMessages: [],
    },
    th,
  );
}

/** Run every detector; return non-null anomalies sorted by severityScore desc. */
export function runAllDetectors(entries: LogEntry[], th: ServiceThresholds): Anomaly[] {
  const results = [
    detectErrorRate(entries, th),
    detectLatency(entries, th),
    detectErrorBurst(entries, th),
    detectFatal(entries, th),
    detectSilence(entries, th),
  ].filter((a): a is Anomaly => a !== null);
  return results.sort((a, b) => b.severityScore - a.severityScore);
}
