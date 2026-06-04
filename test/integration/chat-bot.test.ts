import { describe, it, expect, vi } from 'vitest';
import { createChatBotHandler, createDefaultVerifier } from '../../src/chat/bot.js';
import {
  chatMessage,
  malformedRequest,
  FakeRes,
  fixedAnthropic,
  toolThenAnswerAnthropic,
} from '../fixtures/chatMessages.js';
import { fakeLogging, fakeDeps } from '../fixtures/deps.js';
import { makeEntries } from '../fixtures/logEntries.js';

function ctx(overrides: Partial<Parameters<typeof createChatBotHandler>[0]> = {}) {
  const deps = fakeDeps(fakeLogging({ queryLogs: () => makeEntries(100, 'INFO') }));
  return {
    anthropic: fixedAnthropic('payment-service looks healthy.'),
    model: 'claude-sonnet-4-6',
    deps,
    verify: createDefaultVerifier('aud-123'),
    timeoutMs: 0,
    ...overrides,
  };
}

describe('POST /chat handler', () => {
  it('answers a health question (200, card mentions the service)', async () => {
    const handler = createChatBotHandler(
      ctx({ anthropic: fixedAnthropic('payment-service is healthy right now.') }),
    );
    const res = new FakeRes();
    await handler(chatMessage('is payment-service healthy?'), res);
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.body)).toContain('payment-service');
  });

  it('runs a tool call before answering', async () => {
    const deps = fakeDeps(fakeLogging({ queryLogs: () => makeEntries(100, 'INFO') }));
    const handler = createChatBotHandler({
      anthropic: toolThenAnswerAnthropic(
        'get_service_health',
        { service: 'payment-service' },
        'payment-service is healthy.',
      ),
      model: 'm',
      deps,
      verify: () => true,
      timeoutMs: 0,
    });
    const res = new FakeRes();
    await handler(chatMessage('how is payment-service?'), res);
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.body)).toContain('payment-service');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const handler = createChatBotHandler(ctx());
    const res = new FakeRes();
    await handler(chatMessage('hello', false), res); // no auth header
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 (no crash) on a malformed payload', async () => {
    const handler = createChatBotHandler(ctx({ verify: () => true }));
    const res = new FakeRes();
    await handler(malformedRequest, res);
    expect(res.statusCode).toBe(400);
  });

  it('returns an async ack when the agent exceeds the sync window', async () => {
    // Anthropic client that never resolves within the timeout.
    const slow = {
      messages: {
        create: () => new Promise<never>(() => {}), // hangs
      },
    };
    const onFollowUp = vi.fn();
    const handler = createChatBotHandler({
      anthropic: slow as never,
      model: 'm',
      deps: fakeDeps(fakeLogging({})),
      verify: () => true,
      timeoutMs: 20,
      onFollowUp,
    });
    const res = new FakeRes();
    await handler(chatMessage('slow question'), res);
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.body)).toContain('follow up');
  });
});
