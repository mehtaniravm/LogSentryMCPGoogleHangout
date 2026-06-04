import { buildAnswerCard, type ChatCard } from './cards.js';
import { runAgent, type AnthropicLike } from '../agent/runner.js';
import type { ToolDeps } from '../mcp/tools/types.js';

/** Minimal request/response shapes (structurally compatible with Express). */
export interface ChatReq {
  body?: { type?: string; message?: { text?: string } } & Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
}
export interface ChatRes {
  status(code: number): ChatRes;
  json(body: unknown): unknown;
}

export interface ChatBotContext {
  anthropic: AnthropicLike;
  model: string;
  deps: ToolDeps;
  /** Returns true if the inbound request is an authenticated Google Chat call. */
  verify: (req: ChatReq) => boolean;
  /** Sync-response budget; on overrun the bot returns an async ack. */
  timeoutMs?: number;
  /** Optional sink for the late answer when the sync window is exceeded. */
  onFollowUp?: (card: ChatCard) => Promise<void> | void;
}

const BOT_SYSTEM_PROMPT = [
  'You are LogSentry, a support assistant for a fleet of GCP microservices.',
  'Answer questions about service health, errors, and anomalies by calling the provided read-only tools.',
  'Only state facts returned by the tools. Never invent service names, numbers, or statuses.',
  'Be concise and actionable.',
].join(' ');

/**
 * Default verifier: when an audience is configured, require an Authorization
 * bearer token. VERIFY: replace with full Google Chat JWT signature/audience
 * validation (google-auth-library OAuth2Client.verifyIdToken) before prod.
 */
export function createDefaultVerifier(audience?: string): (req: ChatReq) => boolean {
  return (req) => {
    if (!audience) return true; // dev mode: auth disabled
    const auth = req.headers?.['authorization'];
    const header = Array.isArray(auth) ? auth[0] : auth;
    return typeof header === 'string' && /^Bearer\s+.+/.test(header);
  };
}

interface RaceResult {
  timedOut: boolean;
  text?: string;
  toolsUsed?: string[];
}

async function runWithTimeout(
  ctx: ChatBotContext,
  question: string,
): Promise<RaceResult> {
  const run = runAgent({
    client: ctx.anthropic,
    model: ctx.model,
    system: BOT_SYSTEM_PROMPT,
    deps: ctx.deps,
    messages: [{ role: 'user', content: question }],
  });

  if (!ctx.timeoutMs || ctx.timeoutMs <= 0) {
    const r = await run;
    return { timedOut: false, text: r.text, toolsUsed: r.toolsUsed };
  }

  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<RaceResult>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ctx.timeoutMs);
  });

  const result = await Promise.race([
    run.then((r) => ({ timedOut: false, text: r.text, toolsUsed: r.toolsUsed }) as RaceResult),
    timeout,
  ]);
  clearTimeout(timer!);

  // If we timed out, post the eventual answer via the follow-up sink.
  if (result.timedOut && ctx.onFollowUp) {
    void run.then((r) =>
      ctx.onFollowUp?.(buildAnswerCard(question, r.text, r.toolsUsed)),
    );
  }
  return result;
}

/** Build the POST /chat handler for the Google Chat bot. */
export function createChatBotHandler(ctx: ChatBotContext) {
  return async function handleChat(req: ChatReq, res: ChatRes): Promise<unknown> {
    if (!ctx.verify(req)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const text = req.body?.message?.text;
    if (typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({ error: 'missing message text' });
    }

    try {
      const result = await runWithTimeout(ctx, text.trim());
      if (result.timedOut) {
        return res
          .status(200)
          .json({ text: '🔎 Looking into it — I will follow up with an answer shortly.' });
      }
      return res
        .status(200)
        .json(buildAnswerCard(text.trim(), result.text ?? '', result.toolsUsed ?? []));
    } catch (err) {
      return res.status(200).json({ text: `Sorry, I hit an error: ${(err as Error).message}` });
    }
  };
}
