import { Logging } from '@google-cloud/logging';
import { BigQuery } from '@google-cloud/bigquery';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../config/env.js';
import { createCloudLogging, type LogClient } from '../logging/cloudLogging.js';
import { createBigQuery, type BigQueryClient } from '../logging/bigquery.js';
import { loadThresholds } from '../config/thresholds.js';
import type { ToolDeps } from '../mcp/tools/types.js';
import type { AnthropicLike } from '../agent/runner.js';

/**
 * Adapt the @google-cloud/logging client to our narrow LogClient interface.
 * VERIFY: confirm getEntries option names (filter/pageSize/orderBy) against the
 * installed SDK version and the org's resourceNames scoping.
 */
export function buildLogClient(env: Env): LogClient {
  const logging = new Logging({ projectId: env.GCP_PROJECT_ID });
  return {
    getEntries: (options) =>
      logging.getEntries(options) as ReturnType<LogClient['getEntries']>,
  };
}

export function buildBigQueryClient(env: Env): BigQueryClient {
  const bq = new BigQuery({ projectId: env.GCP_PROJECT_ID });
  return {
    query: (options) => bq.query(options) as ReturnType<BigQueryClient['query']>,
  };
}

export function buildAnthropic(env: Env): AnthropicLike {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client as unknown as AnthropicLike;
}

/** Assemble ToolDeps from real cloud clients and the thresholds config. */
export function buildToolDeps(env: Env): ToolDeps {
  const logging = createCloudLogging(buildLogClient(env), {
    maxLogsPerQuery: env.MAX_LOGS_PER_QUERY,
  });
  return {
    logging,
    config: loadThresholds(),
    defaultWindowMinutes: env.DEFAULT_WINDOW_MINUTES,
    maxLogsPerQuery: env.MAX_LOGS_PER_QUERY,
  };
}

/** Convenience: a read-only BigQuery accessor for historical queries. */
export function buildBigQueryAccess(env: Env) {
  return createBigQuery(buildBigQueryClient(env));
}
