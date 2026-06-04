import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadThresholds,
  getThresholdsForService,
  type ThresholdsConfig,
} from '../../src/config/thresholds.js';

let tmp: string;
let config: ThresholdsConfig;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'logsentry-th-'));
  // Load the real project config (config/thresholds.yaml).
  config = loadThresholds();
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('loadThresholds', () => {
  it('loads valid YAML without throwing', () => {
    expect(() => loadThresholds()).not.toThrow();
    expect(config.defaults.error_rate.max_error_pct).toBe(5.0);
  });

  it('throws a descriptive error on malformed YAML (missing required field)', () => {
    const bad = join(tmp, 'bad.yaml');
    // error_rate is missing max_error_pct → schema violation.
    writeFileSync(
      bad,
      `defaults:
  error_rate:
    window_minutes: 5
    min_volume: 50
  latency:
    window_minutes: 5
    p99_ms_threshold: 2000
  error_burst:
    window_minutes: 1
    max_errors: 100
  fatal:
    window_minutes: 5
    max_fatal: 1
  silence:
    expected_min_logs: 1
    window_minutes: 10
  severity_weights:
    FATAL: 100
    ERROR: 10
    WARN: 2
`,
    );
    expect(() => loadThresholds(bad)).toThrow(/Invalid thresholds config/);
    expect(() => loadThresholds(bad)).toThrow(/max_error_pct/);
  });

  it('throws on unparseable YAML', () => {
    const bad = join(tmp, 'syntax.yaml');
    writeFileSync(bad, 'defaults: [unclosed\n');
    expect(() => loadThresholds(bad)).toThrow(/Malformed thresholds YAML/);
  });

  it('throws when the file does not exist', () => {
    expect(() => loadThresholds(join(tmp, 'nope.yaml'))).toThrow(/Cannot read thresholds file/);
  });
});

describe('getThresholdsForService', () => {
  it('merges per-service override but inherits defaults', () => {
    const t = getThresholdsForService('payment-service', config);
    // override
    expect(t.error_rate.max_error_pct).toBe(1.0);
    expect(t.fatal.max_fatal).toBe(0);
    // inherited from defaults within an overridden group
    expect(t.error_rate.min_volume).toBe(config.defaults.error_rate.min_volume);
    // inherited group untouched by the override
    expect(t.latency.p99_ms_threshold).toBe(config.defaults.latency.p99_ms_threshold);
  });

  it('returns pure defaults for an unknown service', () => {
    const t = getThresholdsForService('unknown-service', config);
    expect(t).toEqual(config.defaults);
  });

  it('applies a single-field override (batch silence window)', () => {
    const t = getThresholdsForService('batch-report-service', config);
    expect(t.silence.window_minutes).toBe(360);
    expect(t.silence.expected_min_logs).toBe(config.defaults.silence.expected_min_logs);
  });
});
