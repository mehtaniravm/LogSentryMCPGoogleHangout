export type Severity =
  | 'DEBUG'
  | 'INFO'
  | 'NOTICE'
  | 'WARN'
  | 'ERROR'
  | 'CRITICAL'
  | 'ALERT'
  | 'FATAL';

export interface LogEntry {
  timestamp: string; // ISO
  service: string;
  severity: Severity;
  message: string;
  traceId?: string;
  latencyMs?: number;
  labels?: Record<string, string>;
}

export interface ServiceHealth {
  service: string;
  windowMinutes: number;
  totalLogs: number;
  errorCount: number;
  fatalCount: number;
  errorPct: number;
  p99LatencyMs?: number;
  status: 'healthy' | 'degraded' | 'critical' | 'silent';
}

export type AnomalyType = 'error_rate' | 'latency' | 'error_burst' | 'fatal' | 'silence';

export interface Anomaly {
  service: string;
  type: AnomalyType;
  detail: string;
  observed: number;
  threshold: number;
  severityScore: number; // from scoring.ts
  sampleMessages: string[]; // up to 3 representative log lines
}
