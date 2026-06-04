import type { Anomaly, AnomalyType } from '../logging/types.js';
import type { SeverityWeights } from '../config/thresholds.js';

/** Map an anomaly type to the severity weight that drives its base urgency. */
function typeWeight(type: AnomalyType, weights: SeverityWeights): number {
  switch (type) {
    case 'fatal':
      return weights.FATAL;
    case 'error_rate':
    case 'error_burst':
    case 'silence':
      return weights.ERROR;
    case 'latency':
      return weights.WARN;
  }
}

/**
 * How badly the observation breaches its threshold (>= for most types). For
 * silence the relation is inverted (fewer logs than expected = worse), so it
 * grows as observed falls toward zero.
 */
function breachMagnitude(a: Anomaly): number {
  if (a.type === 'silence') {
    const t = a.threshold || 1;
    return 1 + Math.max(0, t - a.observed) / t; // observed 0, threshold 1 -> 2
  }
  if (a.threshold <= 0) return a.observed + 1; // e.g. fatal with max_fatal:0
  return a.observed / a.threshold;
}

/**
 * Deterministic urgency score; higher = more urgent. Used to sort anomalies and
 * to pick Chat card color. Same input always yields the same output.
 */
export function scoreAnomaly(a: Anomaly, weights: SeverityWeights): number {
  const score = typeWeight(a.type, weights) * breachMagnitude(a);
  return Math.round(score * 100) / 100;
}
