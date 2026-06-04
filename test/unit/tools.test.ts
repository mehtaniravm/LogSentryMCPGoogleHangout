import { describe, it, expect } from 'vitest';
import { queryLogsTool } from '../../src/mcp/tools/queryLogs.js';
import { getServiceHealthTool } from '../../src/mcp/tools/getServiceHealth.js';
import { findAnomaliesTool } from '../../src/mcp/tools/findAnomalies.js';
import { getErrorSummaryTool, normalizeMessage } from '../../src/mcp/tools/getErrorSummary.js';
import { listServicesTool } from '../../src/mcp/tools/listServices.js';
import { assertReadOnly } from '../../src/logging/bigquery.js';
import { fakeLogging, fakeDeps } from '../fixtures/deps.js';
import { makeEntries, makeEntry, makeLatencyEntries } from '../fixtures/logEntries.js';
import type { LogEntry } from '../../src/logging/types.js';

describe('query_logs tool', () => {
  it('rejects limit > 500', async () => {
    const deps = fakeDeps(fakeLogging({}));
    await expect(queryLogsTool.handler({ windowMinutes: 5, limit: 501 }, deps)).rejects.toThrow();
  });

  it('rejects windowMinutes > 1440', async () => {
    const deps = fakeDeps(fakeLogging({}));
    await expect(queryLogsTool.handler({ windowMinutes: 1441 }, deps)).rejects.toThrow();
  });

  it('passes valid args through to the logging layer', async () => {
    const entries = makeEntries(3, 'ERROR');
    const deps = fakeDeps(fakeLogging({ queryLogs: () => entries }));
    const out = await queryLogsTool.handler({ service: 'svc', windowMinutes: 5 }, deps);
    expect(out).toHaveLength(3);
  });
});

describe('get_service_health tool', () => {
  it('computes errorPct and sets status per thresholds', async () => {
    // 100 logs, 20 ERROR -> 20% error rate; default max_error_pct 5 -> >=2x -> critical
    const entries: LogEntry[] = [...makeEntries(80, 'INFO'), ...makeEntries(20, 'ERROR')];
    const deps = fakeDeps(fakeLogging({ queryLogs: () => entries }));
    const health = await getServiceHealthTool.handler(
      { service: 'cart-service', windowMinutes: 5 },
      deps,
    );
    expect(health.totalLogs).toBe(100);
    expect(health.errorCount).toBe(20);
    expect(health.errorPct).toBe(20);
    expect(health.status).toBe('critical');
  });

  it('reports healthy for a clean window', async () => {
    const entries = makeEntries(100, 'INFO');
    const deps = fakeDeps(fakeLogging({ queryLogs: () => entries }));
    const health = await getServiceHealthTool.handler({ service: 'svc' }, deps);
    expect(health.status).toBe('healthy');
    expect(health.errorPct).toBe(0);
  });

  it('reports silent for an empty window', async () => {
    const deps = fakeDeps(fakeLogging({ queryLogs: () => [] }));
    const health = await getServiceHealthTool.handler({ service: 'svc' }, deps);
    expect(health.status).toBe('silent');
  });

  it('reports degraded on high p99 latency alone', async () => {
    const entries = [
      ...makeEntries(60, 'INFO'),
      ...makeLatencyEntries(Array.from({ length: 40 }, () => 5000)),
    ];
    const deps = fakeDeps(fakeLogging({ queryLogs: () => entries }));
    const health = await getServiceHealthTool.handler({ service: 'svc' }, deps);
    expect(health.p99LatencyMs).toBe(5000);
    expect(health.status).toBe('degraded');
  });
});

describe('find_anomalies tool', () => {
  it('returns anomalies sorted descending by severityScore', async () => {
    // payment-service: fatal override max_fatal:0 -> FATAL is critical; plus error burst
    const entries: LogEntry[] = [
      ...makeEntries(150, 'ERROR'), // burst (>=100) + high error rate
      makeEntry({ severity: 'FATAL', message: 'OOM' }),
    ];
    const deps = fakeDeps(fakeLogging({ queryLogs: () => entries }));
    const anomalies = await findAnomaliesTool.handler({ service: 'payment-service' }, deps);
    expect(anomalies.length).toBeGreaterThan(1);
    for (let i = 1; i < anomalies.length; i++) {
      expect(anomalies[i - 1]!.severityScore).toBeGreaterThanOrEqual(anomalies[i]!.severityScore);
    }
    expect(anomalies.map((a) => a.type)).toContain('fatal');
  });

  it('iterates all services when none is specified', async () => {
    const deps = fakeDeps(
      fakeLogging({
        listServices: () => ['a', 'b'],
        queryLogs: () => [],
      }),
    );
    const anomalies = await findAnomaliesTool.handler({}, deps);
    // empty windows -> silence anomalies for both services
    expect(anomalies.map((a) => a.type)).toEqual(['silence', 'silence']);
  });
});

describe('get_error_summary tool', () => {
  it('clusters similar messages into one normalized signature', async () => {
    const entries: LogEntry[] = [
      makeEntry({ severity: 'ERROR', message: 'NPE at line 42' }),
      makeEntry({ severity: 'ERROR', message: 'NPE at line 87' }),
      makeEntry({ severity: 'ERROR', message: 'Timeout connecting to db-3' }),
    ];
    const deps = fakeDeps(fakeLogging({ queryLogs: () => entries }));
    const out = await getErrorSummaryTool.handler({ service: 'svc' }, deps);
    const npe = out.find((s) => s.signature === 'NPE at line #');
    expect(npe?.count).toBe(2);
    expect(out[0]!.count).toBe(2); // sorted by count desc
  });

  it('normalizeMessage strips digits, uuids, and hex', () => {
    expect(normalizeMessage('NPE at line 42')).toBe('NPE at line #');
    expect(normalizeMessage('user 550e8400-e29b-41d4-a716-446655440000 failed')).toBe(
      'user <uuid> failed',
    );
  });
});

describe('list_services tool', () => {
  it('returns the service list', async () => {
    const deps = fakeDeps(fakeLogging({ listServices: () => ['a', 'b'] }));
    expect(await listServicesTool.handler({}, deps)).toEqual(['a', 'b']);
  });
});

describe('bigquery.assertReadOnly (tools §5.5)', () => {
  it('throws on DELETE and passes on SELECT', () => {
    expect(() => assertReadOnly('DELETE FROM app_logs')).toThrow();
    expect(() => assertReadOnly('SELECT count(*) FROM app_logs')).not.toThrow();
  });
});
