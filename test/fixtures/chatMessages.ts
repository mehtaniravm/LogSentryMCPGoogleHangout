import type { ChatReq } from '../../src/chat/bot.js';

/** A well-formed Google Chat MESSAGE event. */
export function chatMessage(text: string, withAuth = true): ChatReq {
  return {
    headers: withAuth ? { authorization: 'Bearer fake.jwt.token' } : {},
    body: { type: 'MESSAGE', message: { text } },
  };
}

/** A request missing the message body. */
export const malformedRequest: ChatReq = {
  headers: { authorization: 'Bearer fake.jwt.token' },
  body: { type: 'MESSAGE' },
};

/** A captured response for assertions in handler tests. */
export class FakeRes {
  statusCode = 200;
  body: unknown = undefined;
  status(code: number): this {
    this.statusCode = code;
    return this;
  }
  json(body: unknown): unknown {
    this.body = body;
    return body;
  }
}

/** Build a fake Anthropic client that returns a fixed final-text response. */
export function fixedAnthropic(text: string) {
  return {
    messages: {
      create: async () => ({
        stop_reason: 'end_turn' as const,
        content: [{ type: 'text' as const, text }],
      }),
    },
  };
}

/** Build a fake Anthropic client that calls one tool, then answers. */
export function toolThenAnswerAnthropic(toolName: string, toolInput: unknown, finalText: string) {
  let call = 0;
  return {
    messages: {
      create: async () => {
        call += 1;
        if (call === 1) {
          return {
            stop_reason: 'tool_use' as const,
            content: [
              { type: 'tool_use' as const, id: 'tu_1', name: toolName, input: toolInput },
            ],
          };
        }
        return {
          stop_reason: 'end_turn' as const,
          content: [{ type: 'text' as const, text: finalText }],
        };
      },
    },
  };
}
