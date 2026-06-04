import type { LogEntry, Severity } from './types.js';

/**
 * Minimal shape of a @google-cloud/logging entry we depend on. Kept narrow so
 * tests can pass a fake without the real SDK. The real Log/Logging client's
 * `getEntries` resolves to `[entries, nextQuery, apiResponse]`.
 */
export interface RawLogEntry {
  metadata?: {
    timestamp?: string | Date;
    severity?: string | number;
    resource?: { labels?: Record<string, string> };
    labels?: Record<string, string>;
    trace?: string;
    httpRequest?: { latency?: string | { seconds?: number; nanos?: number } };
  };
  data?: unknown; // jsonPayload (object) or textPayload (string)
}

export interface GetEntriesOptions {
  filter?: string;
  pageSize?: number;
  orderBy?: string;
  autoPaginate?: boolean;
}

export interface LogClient {
  getEntries(options: GetEntriesOptions): Promise<[RawLogEntry[], ...unknown[]]>;
}

export interface QueryLogsOptions {
  service?: string;
  minSeverity?: Severity;
  windowMinutes: number;
  limit?: number;
  textFilter?: string;
}

// GCP severity strings differ slightly from our union. VERIFY: confirm against
// the org's actual log4j→Cloud Logging severity mapping.
const SEVERITY_MAP: Record<string, Severity> = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  NOTICE: 'NOTICE',
  WARNING: 'WARN',
  WARN: 'WARN',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL',
  ALERT: 'ALERT',
  EMERGENCY: 'FATAL',
  FATAL: 'FATAL',
};

// Numeric severities from the Logging API (LogSeverity enum).
const NUMERIC_SEVERITY: Record<number, Severity> = {
  100: 'DEBUG',
  200: 'INFO',
  300: 'NOTICE',
  400: 'WARN',
  500: 'ERROR',
  600: 'CRITICAL',
  700: 'ALERT',
  800: 'FATAL',
};

function normalizeSeverity(sev: string | number | undefined): Severity {
  if (typeof sev === 'number') return NUMERIC_SEVERITY[sev] ?? 'INFO';
  if (typeof sev === 'string') return SEVERITY_MAP[sev.toUpperCase()] ?? 'INFO';
  return 'INFO';
}

function extractMessage(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.msg === 'string') return obj.msg;
    return JSON.stringify(obj);
  }
  return '';
}

function extractLatencyMs(meta: RawLogEntry['metadata'], data: unknown): number | undefined {
  // Prefer an explicit latency in the JSON payload.
  if (data && typeof data === 'object') {
    const v = (data as Record<string, unknown>).latencyMs;
    if (typeof v === 'number') return v;
  }
  const lat = meta?.httpRequest?.latency;
  if (typeof lat === 'string') {
    // e.g. "0.123s"
    const m = /^([\d.]+)s$/.exec(lat);
    if (m && m[1]) return Math.round(parseFloat(m[1]) * 1000);
  } else if (lat && typeof lat === 'object') {
    const secs = (lat.seconds ?? 0) + (lat.nanos ?? 0) / 1e9;
    return Math.round(secs * 1000);
  }
  return undefined;
}

function toIso(ts: string | Date | undefined): string {
  if (!ts) return new Date(0).toISOString();
  return ts instanceof Date ? ts.toISOString() : new Date(ts).toISOString();
}

/** Map a raw Cloud Logging entry into our LogEntry contract. */
export function mapEntry(raw: RawLogEntry): LogEntry {
  const meta = raw.metadata ?? {};
  const labels = meta.resource?.labels ?? meta.labels ?? {};
  // VERIFY: schema mapping — confirm the resource label key carrying the service name.
  const service =
    labels.service_name ?? labels.service ?? labels.module_id ?? labels.container_name ?? 'unknown';
  const entry: LogEntry = {
    timestamp: toIso(meta.timestamp),
    service,
    severity: normalizeSeverity(meta.severity),
    message: extractMessage(raw.data),
  };
  if (meta.trace) entry.traceId = meta.trace;
  const latencyMs = extractLatencyMs(meta, raw.data);
  if (latencyMs !== undefined) entry.latencyMs = latencyMs;
  if (meta.labels && Object.keys(meta.labels).length > 0) entry.labels = meta.labels;
  return entry;
}

/** Quote a value for inclusion in a Cloud Logging advanced filter. */
function quote(v: string): string {
  return `"${v.replace(/"/g, '\\"')}"`;
}

/** Build a Cloud Logging advanced filter string from query options. */
export function buildFilter(opts: QueryLogsOptions, now: Date = new Date()): string {
  const clauses: string[] = [];
  if (opts.service) {
    // VERIFY: schema mapping — resource label key for service name.
    clauses.push(`resource.labels.service_name=${quote(opts.service)}`);
  }
  if (opts.minSeverity) {
    clauses.push(`severity>=${opts.minSeverity}`);
  }
  const since = new Date(now.getTime() - opts.windowMinutes * 60_000).toISOString();
  clauses.push(`timestamp>=${quote(since)}`);
  if (opts.textFilter) {
    clauses.push(quote(opts.textFilter));
  }
  return clauses.join(' AND ');
}

export interface CloudLogging {
  queryLogs(opts: QueryLogsOptions): Promise<LogEntry[]>;
  listServices(): Promise<string[]>;
}

/**
 * Factory: inject a LogClient (real @google-cloud/logging instance or a fake)
 * so all access is testable offline.
 */
export function createCloudLogging(
  client: LogClient,
  config: { maxLogsPerQuery?: number } = {},
): CloudLogging {
  const hardCap = config.maxLogsPerQuery ?? 500;

  async function queryLogs(opts: QueryLogsOptions): Promise<LogEntry[]> {
    const limit = Math.min(opts.limit ?? hardCap, hardCap);
    const filter = buildFilter(opts);
    const [entries] = await client.getEntries({
      filter,
      pageSize: limit,
      orderBy: 'timestamp desc',
      autoPaginate: false,
    });
    return entries.slice(0, limit).map(mapEntry);
  }

  async function listServices(): Promise<string[]> {
    // Distinct service names seen in the last 24h. Cloud Logging has no DISTINCT,
    // so we scan a bounded window and dedup. VERIFY: at 90 services consider a
    // log-based metric instead of scanning raw entries.
    const filter = buildFilter({ windowMinutes: 24 * 60 });
    const [entries] = await client.getEntries({
      filter,
      pageSize: hardCap,
      orderBy: 'timestamp desc',
      autoPaginate: false,
    });
    const names = new Set<string>();
    for (const e of entries) names.add(mapEntry(e).service);
    names.delete('unknown');
    return [...names].sort();
  }

  return { queryLogs, listServices };
}
