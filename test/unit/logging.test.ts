import { describe, it, expect, vi } from 'vitest';
import {
  createCloudLogging,
  buildFilter,
  mapEntry,
  type LogClient,
  type RawLogEntry,
} from '../../src/logging/cloudLogging.js';
import {
  createBigQuery,
  assertReadOnly,
  type BigQueryClient,
} from '../../src/logging/bigquery.js';

function fakeLogClient(entries: RawLogEntry[]): LogClient {
  return {
    getEntries: vi.fn(async () => [entries] as [RawLogEntry[]]),
  };
}

describe('buildFilter', () => {
  const now = new Date('2026-06-03T12:00:00.000Z');

  it('includes service, severity, time window, and text filter', () => {
    const f = buildFilter(
      { service: 'payment-service', minSeverity: 'ERROR', windowMinutes: 5, textFilter: 'timeout' },
      now,
    );
    expect(f).toContain('resource.labels.service_name="payment-service"');
    expect(f).toContain('severity>=ERROR');
    expect(f).toContain('timestamp>="2026-06-03T11:55:00.000Z"');
    expect(f).toContain('"timeout"');
    expect(f).toContain(' AND ');
  });

  it('omits service/severity clauses when not provided', () => {
    const f = buildFilter({ windowMinutes: 60 }, now);
    expect(f).not.toContain('resource.labels');
    expect(f).not.toContain('severity');
    expect(f).toContain('timestamp>=');
  });
});

describe('mapEntry', () => {
  it('maps GCP severity strings and extracts message + latency', () => {
    const raw: RawLogEntry = {
      metadata: {
        timestamp: '2026-06-03T11:59:00Z',
        severity: 'WARNING',
        resource: { labels: { service_name: 'cart-service' } },
        trace: 'projects/x/traces/abc',
        httpRequest: { latency: '0.250s' },
      },
      data: { message: 'slow path' },
    };
    const e = mapEntry(raw);
    expect(e.service).toBe('cart-service');
    expect(e.severity).toBe('WARN');
    expect(e.message).toBe('slow path');
    expect(e.latencyMs).toBe(250);
    expect(e.traceId).toBe('projects/x/traces/abc');
  });

  it('maps EMERGENCY to FATAL and falls back to unknown service', () => {
    const e = mapEntry({ metadata: { severity: 'EMERGENCY' }, data: 'boom' });
    expect(e.severity).toBe('FATAL');
    expect(e.service).toBe('unknown');
    expect(e.message).toBe('boom');
  });

  it('maps numeric severities', () => {
    expect(mapEntry({ metadata: { severity: 500 } }).severity).toBe('ERROR');
    expect(mapEntry({ metadata: { severity: 800 } }).severity).toBe('FATAL');
  });
});

describe('createCloudLogging.queryLogs', () => {
  it('returns mapped entries and caps at the limit', async () => {
    const raws: RawLogEntry[] = Array.from({ length: 10 }, (_, i) => ({
      metadata: { severity: 'ERROR', resource: { labels: { service_name: 'svc' } } },
      data: { message: `m${i}` },
    }));
    const client = fakeLogClient(raws);
    const cl = createCloudLogging(client, { maxLogsPerQuery: 500 });
    const out = await cl.queryLogs({ service: 'svc', windowMinutes: 5, limit: 3 });
    expect(out).toHaveLength(3);
    expect(out[0]?.service).toBe('svc');
  });

  it('enforces the hard cap even if a larger limit is requested', async () => {
    const raws: RawLogEntry[] = Array.from({ length: 20 }, () => ({
      metadata: { severity: 'INFO', resource: { labels: { service_name: 'svc' } } },
      data: 'x',
    }));
    const cl = createCloudLogging(fakeLogClient(raws), { maxLogsPerQuery: 5 });
    const out = await cl.queryLogs({ windowMinutes: 5, limit: 9999 });
    expect(out).toHaveLength(5);
  });
});

describe('createCloudLogging.listServices', () => {
  it('returns distinct, sorted service names excluding unknown', async () => {
    const raws: RawLogEntry[] = [
      { metadata: { resource: { labels: { service_name: 'b-svc' } } }, data: '1' },
      { metadata: { resource: { labels: { service_name: 'a-svc' } } }, data: '2' },
      { metadata: { resource: { labels: { service_name: 'b-svc' } } }, data: '3' },
      { metadata: {}, data: '4' }, // -> unknown, filtered out
    ];
    const cl = createCloudLogging(fakeLogClient(raws));
    const svcs = await cl.listServices();
    expect(svcs).toEqual(['a-svc', 'b-svc']);
  });
});

describe('assertReadOnly', () => {
  it('passes a SELECT query', () => {
    expect(() => assertReadOnly('SELECT * FROM app_logs WHERE created_at > @t')).not.toThrow();
  });

  it('throws on DELETE / INSERT / UPDATE / DROP / MERGE', () => {
    for (const q of [
      'DELETE FROM app_logs',
      'insert into app_logs values (1)',
      'UPDATE app_logs SET x=1',
      'DROP TABLE app_logs',
      'MERGE INTO app_logs USING s ON x',
    ]) {
      expect(() => assertReadOnly(q)).toThrow(/Read-only guard/);
    }
  });

  it('does not false-positive on column names containing keywords', () => {
    expect(() => assertReadOnly('SELECT created_at, updated_count FROM t')).not.toThrow();
  });
});

describe('createBigQuery.queryHistorical', () => {
  it('runs read-only queries and returns rows', async () => {
    const rows = [{ n: 1 }];
    const client: BigQueryClient = { query: vi.fn(async () => [rows] as [typeof rows]) };
    const bq = createBigQuery(client);
    const out = await bq.queryHistorical('SELECT 1 AS n');
    expect(out).toEqual(rows);
    expect(client.query).toHaveBeenCalledWith({ query: 'SELECT 1 AS n', params: {} });
  });

  it('rejects a mutating query before hitting the client', async () => {
    const client: BigQueryClient = { query: vi.fn() };
    const bq = createBigQuery(client);
    await expect(bq.queryHistorical('DELETE FROM app_logs')).rejects.toThrow(/Read-only guard/);
    expect(client.query).not.toHaveBeenCalled();
  });
});
