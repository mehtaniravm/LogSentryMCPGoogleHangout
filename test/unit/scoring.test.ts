import { describe, it, expect } from 'vitest';
import { scoreAnomaly } from '../../src/anomaly/scoring.js';
import type { Anomaly } from '../../src/logging/types.js';
import type { SeverityWeights } from '../../src/config/thresholds.js';

const weights: SeverityWeights = { FATAL: 100, ERROR: 10, WARN: 2 };

function anomaly(over: Partial<Anomaly>): Anomaly {
  return {
    service: 'svc',
    type: 'error_rate',
    detail: '',
    observed: 10,
    threshold: 5,
    severityScore: 0,
    sampleMessages: [],
    ...over,
  };
}

describe('scoreAnomaly', () => {
  it('FATAL anomaly scores higher than ERROR anomaly with the same counts', () => {
    const fatal = scoreAnomaly(anomaly({ type: 'fatal', observed: 10, threshold: 5 }), weights);
    const err = scoreAnomaly(anomaly({ type: 'error_rate', observed: 10, threshold: 5 }), weights);
    expect(fatal).toBeGreaterThan(err);
  });

  it('is deterministic (same input -> same output)', () => {
    const a = anomaly({ type: 'error_burst', observed: 150, threshold: 100 });
    expect(scoreAnomaly(a, weights)).toBe(scoreAnomaly(a, weights));
  });

  it('higher observed/threshold ratio -> higher score within the same type', () => {
    const low = scoreAnomaly(anomaly({ observed: 10, threshold: 5 }), weights); // ratio 2
    const high = scoreAnomaly(anomaly({ observed: 15, threshold: 5 }), weights); // ratio 3
    expect(high).toBeGreaterThan(low);
  });

  it('handles a zero threshold (fatal max_fatal:0) without dividing by zero', () => {
    const s = scoreAnomaly(anomaly({ type: 'fatal', observed: 2, threshold: 0 }), weights);
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThan(0);
  });
});
