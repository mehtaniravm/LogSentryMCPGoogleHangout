import { describe, it, expect } from 'vitest';
import {
  detectErrorRate,
  detectLatency,
  detectErrorBurst,
  detectFatal,
  detectSilence,
  runAllDetectors,
  percentile,
} from '../../src/anomaly/detectors.js';
import type { ServiceThresholds } from '../../src/config/thresholds.js';
import { makeEntries, makeLatencyEntries, mixedFixture, makeEntry } from '../fixtures/logEntries.js';

function th(): ServiceThresholds {
  return {
    error_rate: { window_minutes: 5, max_error_pct: 5, min_volume: 50 },
    latency: { window_minutes: 5, p99_ms_threshold: 2000 },
    error_burst: { window_minutes: 1, max_errors: 100 },
    fatal: { window_minutes: 5, max_fatal: 1 },
    silence: { expected_min_logs: 1, window_minutes: 10 },
    severity_weights: { FATAL: 100, ERROR: 10, WARN: 2 },
  };
}

describe('percentile', () => {
  it('nearest-rank picks near the max for p99', () => {
    const vals = Array.from({ length: 100 }, (_, i) => i * 50); // 0,50,...,4950
    expect(percentile(vals, 99)).toBe(4900); // nearest-rank: 99th value (index 98)
  });
  it('returns 0 for empty', () => {
    expect(percentile([], 99)).toBe(0);
  });
});

describe('detectErrorRate', () => {
  it('flags 10% error rate over a 5% threshold', () => {
    const entries = [...makeEntries(54, 'INFO'), ...makeEntries(6, 'ERROR')]; // 60 total, 10%
    const a = detectErrorRate(entries, th());
    expect(a).not.toBeNull();
    expect(a?.observed).toBeCloseTo(10, 5);
    expect(a?.threshold).toBe(5);
    expect(a?.type).toBe('error_rate');
  });

  it('respects min_volume (50% errors but only 10 logs -> null)', () => {
    const entries = [...makeEntries(5, 'INFO'), ...makeEntries(5, 'ERROR')]; // 10 total
    expect(detectErrorRate(entries, th())).toBeNull();
  });
});

describe('detectFatal', () => {
  it('1 FATAL with max_fatal:0 -> anomaly', () => {
    const t = th();
    t.fatal.max_fatal = 0;
    const entries = [makeEntry({ severity: 'FATAL', message: 'boom' })];
    const a = detectFatal(entries, t);
    expect(a?.observed).toBe(1);
    expect(a?.threshold).toBe(0);
  });

  it('1 FATAL with max_fatal:1 -> null', () => {
    const entries = [makeEntry({ severity: 'FATAL' })];
    expect(detectFatal(entries, th())).toBeNull();
  });
});

describe('detectErrorBurst', () => {
  it('120 errors with max_errors:100 -> anomaly', () => {
    const a = detectErrorBurst(makeEntries(120, 'ERROR'), th());
    expect(a?.observed).toBe(120);
    expect(a?.threshold).toBe(100);
  });
  it('80 errors -> null', () => {
    expect(detectErrorBurst(makeEntries(80, 'ERROR'), th())).toBeNull();
  });
});

describe('detectLatency', () => {
  it('p99 above threshold -> anomaly', () => {
    // top 2% are slow so the p99 (index 98) lands on 5000
    const lat = Array.from({ length: 100 }, (_, i) => (i >= 98 ? 5000 : 100));
    const a = detectLatency(makeLatencyEntries(lat), th());
    expect(a).not.toBeNull();
    expect(a?.observed).toBe(5000);
    expect(a?.threshold).toBe(2000);
  });
  it('all latencies below threshold -> null', () => {
    const a = detectLatency(makeLatencyEntries([100, 500, 1000, 1500]), th());
    expect(a).toBeNull();
  });
  it('no latency data -> null', () => {
    expect(detectLatency(makeEntries(10, 'INFO'), th())).toBeNull();
  });
});

describe('detectSilence', () => {
  it('0 logs with expected_min_logs:1 -> anomaly', () => {
    const a = detectSilence([], th());
    expect(a?.type).toBe('silence');
    expect(a?.observed).toBe(0);
    expect(a?.threshold).toBe(1);
  });
  it('enough logs -> null', () => {
    expect(detectSilence(makeEntries(5, 'INFO'), th())).toBeNull();
  });
});

describe('runAllDetectors', () => {
  it('returns the expected set from the mixed fixture, sorted desc, no duplicates', () => {
    const t = th();
    t.fatal.max_fatal = 0; // make the single FATAL alert-worthy
    const anomalies = runAllDetectors(mixedFixture(), t);
    const types = anomalies.map((a) => a.type);
    // error_rate (7/60 ~11.7%), fatal (1>0), latency (5000>2000) expected; no burst (7<100), no silence
    expect(types).toContain('error_rate');
    expect(types).toContain('fatal');
    expect(types).toContain('latency');
    expect(types).not.toContain('error_burst');
    expect(types).not.toContain('silence');
    // no duplicate types
    expect(new Set(types).size).toBe(types.length);
    // sorted descending by severityScore
    for (let i = 1; i < anomalies.length; i++) {
      expect(anomalies[i - 1]!.severityScore).toBeGreaterThanOrEqual(anomalies[i]!.severityScore);
    }
  });
});
