import type { LogEntry, Severity } from '../../src/logging/types.js';

const BASE_TS = '2026-06-03T12:00:00.000Z';

export function makeEntry(over: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: BASE_TS,
    service: 'test-service',
    severity: 'INFO',
    message: 'ok',
    ...over,
  };
}

/** Build `n` entries of a given severity with an indexed message. */
export function makeEntries(n: number, severity: Severity, prefix = 'msg'): LogEntry[] {
  return Array.from({ length: n }, (_, i) =>
    makeEntry({ severity, message: `${prefix} ${i}` }),
  );
}

/** Build entries carrying the given latency values (severity INFO). */
export function makeLatencyEntries(latencies: number[]): LogEntry[] {
  return latencies.map((latencyMs, i) =>
    makeEntry({ message: `req ${i}`, latencyMs }),
  );
}

/**
 * Mixed fixture: 60 logs total, 6 ERROR (10%), 1 FATAL, plus a high-latency
 * tail. Used by runAllDetectors and tools tests.
 */
export function mixedFixture(): LogEntry[] {
  const info = makeEntries(53, 'INFO');
  const errors = makeEntries(6, 'ERROR', 'NPE at line');
  const fatal = [makeEntry({ severity: 'FATAL', message: 'OutOfMemoryError' })];
  // attach latency to a few entries, one slow
  const slow = makeEntry({ message: 'slow query', latencyMs: 5000 });
  return [...info, ...errors, ...fatal, slow];
}
