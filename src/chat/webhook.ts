import type { ChatCard } from './cards.js';
import type { Anomaly } from '../logging/types.js';

export interface WebhookOptions {
  webhookUrl?: string;
  cooldownMinutes: number;
  maxRetries?: number;
  fetchFn?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SendResult {
  sent: boolean;
  suppressed: string[];
  reason?: string;
}

const keyOf = (a: Anomaly): string => `${a.service}:${a.type}`;
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface AlertSender {
  /** Send an alert card unless every anomaly key is within its cooldown window. */
  sendAlert(card: ChatCard, anomalies: Anomaly[]): Promise<SendResult>;
  /** POST a card directly, bypassing dedup/cooldown (e.g. interactive answers). */
  postCard(card: ChatCard): Promise<void>;
}

/**
 * Build an alert sender with in-memory dedup/cooldown and retry with backoff.
 * The same `service+type` is not re-alerted within `cooldownMinutes`.
 */
export function createAlertSender(opts: WebhookOptions): AlertSender {
  const lastSent = new Map<string, number>();
  const cooldownMs = opts.cooldownMinutes * 60_000;
  const maxRetries = opts.maxRetries ?? 3;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const doFetch = opts.fetchFn ?? fetch;

  async function post(body: unknown): Promise<void> {
    if (!opts.webhookUrl) {
      throw new Error('GOOGLE_CHAT_WEBHOOK_URL is not configured');
    }
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const res = await doFetch(opts.webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) return;
        lastErr = new Error(`Chat webhook returned ${res.status}`);
      } catch (err) {
        lastErr = err as Error;
      }
      if (attempt < maxRetries - 1) await sleep(100 * 2 ** attempt);
    }
    throw lastErr ?? new Error('Chat webhook failed');
  }

  async function sendAlert(card: ChatCard, anomalies: Anomaly[]): Promise<SendResult> {
    const t = now();
    const suppressed: string[] = [];
    const fresh: string[] = [];
    for (const a of anomalies) {
      const key = keyOf(a);
      const last = lastSent.get(key);
      if (last !== undefined && t - last < cooldownMs) {
        suppressed.push(key);
      } else {
        fresh.push(key);
      }
    }

    if (fresh.length === 0) {
      return { sent: false, suppressed, reason: 'all anomalies within cooldown' };
    }

    await post(card);
    // Record send time for every anomaly key included in this card.
    for (const a of anomalies) lastSent.set(keyOf(a), t);
    return { sent: true, suppressed };
  }

  async function postCard(card: ChatCard): Promise<void> {
    await post(card);
  }

  return { sendAlert, postCard };
}
