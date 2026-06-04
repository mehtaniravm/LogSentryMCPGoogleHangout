import { describe, it, expect, vi } from 'vitest';
import { runMonitorCycle, extractJson } from '../../src/agent/monitor.js';
import { createAlertSender } from '../../src/chat/webhook.js';
import { fakeLogging, fakeDeps } from '../fixtures/deps.js';
import type { Anomaly } from '../../src/logging/types.js';
import type { AnthropicLike } from '../../src/agent/runner.js';

const fatalAnomaly: Anomaly = {
  service: 'payment-service',
  type: 'fatal',
  detail: '1 FATAL log',
  observed: 1,
  threshold: 0,
  severityScore: 200,
  sampleMessages: ['OutOfMemoryError'],
};

/** Anthropic stub that returns a fixed JSON decision as its final text. */
function jsonAnthropic(decision: unknown): AnthropicLike {
  return {
    messages: {
      create: async () => ({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(decision) }],
      }),
    },
  };
}

function rawAnthropic(text: string): AnthropicLike {
  return {
    messages: {
      create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }),
    },
  };
}

function baseCtx() {
  return {
    model: 'claude-sonnet-4-6',
    deps: fakeDeps(fakeLogging({})),
    windowMinutes: 5,
    projectId: 'proj-1',
  };
}

describe('extractJson', () => {
  it('parses bare JSON and fenced JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('here:\n```json\n{"b":2}\n```')).toEqual({ b: 2 });
  });
  it('throws on non-JSON', () => {
    expect(() => extractJson('no json here')).toThrow();
  });
});

describe('runMonitorCycle', () => {
  it('sends one red-card alert when Claude returns shouldAlert:true', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true }) as Response);
    const sender = createAlertSender({
      webhookUrl: 'https://chat.example/hook',
      cooldownMinutes: 30,
      fetchFn,
      now: () => 1000,
    });
    const sendSpy = vi.spyOn(sender, 'sendAlert');

    const outcome = await runMonitorCycle({
      ...baseCtx(),
      anthropic: jsonAnthropic({
        shouldAlert: true,
        anomalies: [fatalAnomaly],
        summary: 'payment-service has a FATAL',
      }),
      sender,
    });

    expect(outcome.alerted).toBe(true);
    expect(sendSpy).toHaveBeenCalledOnce();
    expect(fetchFn).toHaveBeenCalledOnce();
    // card argument is red
    expect(sendSpy.mock.calls[0]![0].color).toBe('red');
  });

  it('does not call the webhook when shouldAlert:false', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true }) as Response);
    const sender = createAlertSender({
      webhookUrl: 'https://chat.example/hook',
      cooldownMinutes: 30,
      fetchFn,
    });
    const outcome = await runMonitorCycle({
      ...baseCtx(),
      anthropic: jsonAnthropic({ shouldAlert: false, anomalies: [], summary: 'all healthy' }),
      sender,
    });
    expect(outcome.alerted).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('respects cooldown across two cycles with the same service+type', async () => {
    let clock = 1000;
    const fetchFn = vi.fn(async () => ({ ok: true }) as Response);
    const sender = createAlertSender({
      webhookUrl: 'https://chat.example/hook',
      cooldownMinutes: 30,
      fetchFn,
      now: () => clock,
    });
    const ctx = {
      ...baseCtx(),
      anthropic: jsonAnthropic({
        shouldAlert: true,
        anomalies: [fatalAnomaly],
        summary: 's',
      }),
      sender,
    };

    const first = await runMonitorCycle(ctx);
    clock += 60_000; // +1 min, still within 30-min cooldown
    const second = await runMonitorCycle(ctx);

    expect(first.alerted).toBe(true);
    expect(second.alerted).toBe(false);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('does not crash or alert on malformed (non-JSON) model output', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true }) as Response);
    const sender = createAlertSender({
      webhookUrl: 'https://chat.example/hook',
      cooldownMinutes: 30,
      fetchFn,
    });
    const logs: string[] = [];
    const outcome = await runMonitorCycle({
      ...baseCtx(),
      anthropic: rawAnthropic('I think everything is fine, no JSON here.'),
      sender,
      logger: (m) => logs.push(m),
    });
    expect(outcome.error).toMatch(/malformed decision/);
    expect(outcome.alerted).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes('malformed'))).toBe(true);
  });

  it('in DRY_RUN builds a decision but does not post', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true }) as Response);
    const sender = createAlertSender({
      webhookUrl: 'https://chat.example/hook',
      cooldownMinutes: 30,
      fetchFn,
    });
    const outcome = await runMonitorCycle({
      ...baseCtx(),
      dryRun: true,
      anthropic: jsonAnthropic({ shouldAlert: true, anomalies: [fatalAnomaly], summary: 's' }),
      sender,
    });
    expect(outcome.shouldAlert).toBe(true);
    expect(outcome.alerted).toBe(false);
    expect(outcome.dryRun).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
