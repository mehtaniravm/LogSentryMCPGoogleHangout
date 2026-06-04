import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- zod schemas for each threshold group (all fields required in defaults) ---

const errorRateSchema = z.object({
  window_minutes: z.number().positive(),
  max_error_pct: z.number().min(0).max(100),
  min_volume: z.number().int().nonnegative(),
});

const latencySchema = z.object({
  window_minutes: z.number().positive(),
  p99_ms_threshold: z.number().positive(),
});

const errorBurstSchema = z.object({
  window_minutes: z.number().positive(),
  max_errors: z.number().int().nonnegative(),
});

const fatalSchema = z.object({
  window_minutes: z.number().positive(),
  max_fatal: z.number().int().nonnegative(),
});

const silenceSchema = z.object({
  expected_min_logs: z.number().int().nonnegative(),
  window_minutes: z.number().positive(),
});

const severityWeightsSchema = z.object({
  FATAL: z.number(),
  ERROR: z.number(),
  WARN: z.number(),
});

const defaultsSchema = z.object({
  error_rate: errorRateSchema,
  latency: latencySchema,
  error_burst: errorBurstSchema,
  fatal: fatalSchema,
  silence: silenceSchema,
  severity_weights: severityWeightsSchema,
});

// Per-service overrides: every group optional, and within a group every field optional.
const serviceOverrideSchema = z.object({
  error_rate: errorRateSchema.partial().optional(),
  latency: latencySchema.partial().optional(),
  error_burst: errorBurstSchema.partial().optional(),
  fatal: fatalSchema.partial().optional(),
  silence: silenceSchema.partial().optional(),
  severity_weights: severityWeightsSchema.partial().optional(),
});

const configSchema = z.object({
  defaults: defaultsSchema,
  services: z.record(z.string(), serviceOverrideSchema).optional().default({}),
});

export type ThresholdsConfig = z.infer<typeof configSchema>;
export type ServiceThresholds = z.infer<typeof defaultsSchema>;
export type SeverityWeights = z.infer<typeof severityWeightsSchema>;

const DEFAULT_PATH = resolve(__dirname, '../../config/thresholds.yaml');

/** Load + validate a thresholds YAML file. Throws a descriptive error on malformed config. */
export function loadThresholds(path: string = DEFAULT_PATH): ThresholdsConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read thresholds file at ${path}: ${(err as Error).message}`);
  }

  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (err) {
    throw new Error(`Malformed thresholds YAML at ${path}: ${(err as Error).message}`);
  }

  const parsed = configSchema.safeParse(doc);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid thresholds config at ${path}:\n${issues}`);
  }
  return parsed.data;
}

/** Shallow-merge each override group onto the default group (field-level override). */
function mergeGroup<T extends Record<string, unknown>>(base: T, override?: Partial<T>): T {
  if (!override) return base;
  return { ...base, ...override };
}

/**
 * Resolve effective thresholds for a service: defaults with any per-service
 * field-level overrides merged in. Unknown services get pure defaults.
 */
export function getThresholdsForService(
  service: string,
  config: ThresholdsConfig,
): ServiceThresholds {
  const d = config.defaults;
  const o = config.services?.[service];
  if (!o) return d;
  return {
    error_rate: mergeGroup(d.error_rate, o.error_rate),
    latency: mergeGroup(d.latency, o.latency),
    error_burst: mergeGroup(d.error_burst, o.error_burst),
    fatal: mergeGroup(d.fatal, o.fatal),
    silence: mergeGroup(d.silence, o.silence),
    severity_weights: mergeGroup(d.severity_weights, o.severity_weights),
  };
}
