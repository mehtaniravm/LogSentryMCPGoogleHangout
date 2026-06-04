import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

/** Coerce a string env var into a positive integer. */
const intFromEnv = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int().positive());

const boolFlag = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return def;
      return v === '1' || v.toLowerCase() === 'true';
    })
    .pipe(z.boolean());

export const envSchema = z.object({
  // GCP
  GCP_PROJECT_ID: z.string().min(1, 'GCP_PROJECT_ID is required'),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  BIGQUERY_DATASET: z.string().default('logsentry'),
  BIGQUERY_LOGS_TABLE: z.string().default('app_logs'),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),

  // Google Chat
  GOOGLE_CHAT_WEBHOOK_URL: z.string().url().optional(),
  GOOGLE_CHAT_AUDIENCE: z.string().optional(),

  // Behavior
  MONITOR_INTERVAL_MINUTES: intFromEnv(5),
  DEFAULT_WINDOW_MINUTES: intFromEnv(5),
  ALERT_COOLDOWN_MINUTES: intFromEnv(30),
  MAX_LOGS_PER_QUERY: intFromEnv(500),

  // Runtime
  PORT: intFromEnv(8080),
  MCP_TRANSPORT: z.enum(['http', 'stdio']).default('http'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DRY_RUN: boolFlag(false),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Parse and validate process.env once. Throws a descriptive ZodError on
 * missing/invalid required vars. Pass an explicit source for testing.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

/** Lazily-parsed, cached env for app code. Tests should call loadEnv() directly. */
export function getEnv(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}
