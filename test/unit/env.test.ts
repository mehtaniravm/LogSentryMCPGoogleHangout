import { describe, it, expect } from 'vitest';
import { loadEnv } from '../../src/config/env.js';

const VALID = {
  GCP_PROJECT_ID: 'proj-1',
  ANTHROPIC_API_KEY: 'sk-ant-test',
} as NodeJS.ProcessEnv;

describe('loadEnv', () => {
  it('parses a minimal valid env and applies defaults', () => {
    const env = loadEnv({ ...VALID });
    expect(env.GCP_PROJECT_ID).toBe('proj-1');
    expect(env.BIGQUERY_DATASET).toBe('logsentry');
    expect(env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-6');
    expect(env.MONITOR_INTERVAL_MINUTES).toBe(5);
    expect(env.MAX_LOGS_PER_QUERY).toBe(500);
    expect(env.PORT).toBe(8080);
    expect(env.MCP_TRANSPORT).toBe('http');
    expect(env.DRY_RUN).toBe(false);
  });

  it('coerces numeric and boolean strings', () => {
    const env = loadEnv({
      ...VALID,
      MONITOR_INTERVAL_MINUTES: '10',
      MAX_LOGS_PER_QUERY: '250',
      PORT: '9090',
      DRY_RUN: '1',
    });
    expect(env.MONITOR_INTERVAL_MINUTES).toBe(10);
    expect(env.MAX_LOGS_PER_QUERY).toBe(250);
    expect(env.PORT).toBe(9090);
    expect(env.DRY_RUN).toBe(true);
  });

  it('accepts true/false strings for flags', () => {
    expect(loadEnv({ ...VALID, DRY_RUN: 'true' }).DRY_RUN).toBe(true);
    expect(loadEnv({ ...VALID, DRY_RUN: 'false' }).DRY_RUN).toBe(false);
  });

  it('throws a descriptive error when a required var is missing', () => {
    expect(() => loadEnv({ ANTHROPIC_API_KEY: 'x' } as NodeJS.ProcessEnv)).toThrow(
      /GCP_PROJECT_ID/,
    );
    expect(() => loadEnv({ GCP_PROJECT_ID: 'p' } as NodeJS.ProcessEnv)).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it('rejects an invalid MCP_TRANSPORT enum', () => {
    expect(() => loadEnv({ ...VALID, MCP_TRANSPORT: 'carrier-pigeon' })).toThrow(
      /MCP_TRANSPORT/,
    );
  });

  it('rejects a non-positive integer', () => {
    expect(() => loadEnv({ ...VALID, PORT: '-1' })).toThrow(/PORT/);
  });

  it('rejects a malformed webhook URL', () => {
    expect(() => loadEnv({ ...VALID, GOOGLE_CHAT_WEBHOOK_URL: 'not-a-url' })).toThrow(
      /GOOGLE_CHAT_WEBHOOK_URL/,
    );
  });
});
