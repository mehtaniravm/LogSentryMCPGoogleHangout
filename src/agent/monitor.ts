import { z } from 'zod';
import { MONITOR_SYSTEM_PROMPT } from './prompt.js';
import { runAgent, type AnthropicLike } from './runner.js';
import { buildAlertCard } from '../chat/cards.js';
import type { AlertSender } from '../chat/webhook.js';
import type { ToolDeps } from '../mcp/tools/types.js';
import type { Anomaly } from '../logging/types.js';

const anomalySchema = z.object({
  service: z.string(),
  type: z.enum(['error_rate', 'latency', 'error_burst', 'fatal', 'silence']),
  detail: z.string().default(''),
  observed: z.number().default(0),
  threshold: z.number().default(0),
  severityScore: z.number().default(0),
  sampleMessages: z.array(z.string()).default([]),
});

const decisionSchema = z.object({
  shouldAlert: z.boolean(),
  anomalies: z.array(anomalySchema).default([]),
  summary: z.string().default(''),
});

export type MonitorDecision = z.infer<typeof decisionSchema>;

export interface MonitorContext {
  anthropic: AnthropicLike;
  model: string;
  deps: ToolDeps;
  sender: AlertSender;
  windowMinutes: number;
  projectId?: string;
  dryRun?: boolean;
  logger?: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface CycleOutcome {
  shouldAlert: boolean;
  alerted: boolean;
  dryRun: boolean;
  anomalies: Anomaly[];
  summary: string;
  suppressed?: string[];
  error?: string;
}

/** Extract a JSON object from model text, tolerating ```json fences / surrounding prose. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('no JSON object found in model output');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Run one monitoring cycle: ask Claude (with tools) to assess fleet health,
 * parse its JSON-only decision safely, and alert if warranted (respecting
 * dedup/cooldown). Never throws on malformed model output — it logs and
 * returns an outcome with `error` set instead.
 */
export async function runMonitorCycle(ctx: MonitorContext): Promise<CycleOutcome> {
  const log = ctx.logger ?? (() => {});
  const dryRun = ctx.dryRun ?? false;

  const userPrompt =
    `Assess the health of the fleet over the last ${ctx.windowMinutes} minutes. ` +
    `Use find_anomalies (and other tools as needed), then return your JSON decision.`;

  let run;
  try {
    run = await runAgent({
      client: ctx.anthropic,
      model: ctx.model,
      system: MONITOR_SYSTEM_PROMPT,
      deps: ctx.deps,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 2048,
    });
  } catch (err) {
    const error = `agent run failed: ${(err as Error).message}`;
    log(error);
    return { shouldAlert: false, alerted: false, dryRun, anomalies: [], summary: '', error };
  }

  let decision: MonitorDecision;
  try {
    decision = decisionSchema.parse(extractJson(run.text));
  } catch (err) {
    const error = `malformed decision: ${(err as Error).message}`;
    log(error, { rawOutput: run.text });
    return { shouldAlert: false, alerted: false, dryRun, anomalies: [], summary: '', error };
  }

  const anomalies = decision.anomalies as Anomaly[];

  if (!decision.shouldAlert || anomalies.length === 0) {
    log('cycle complete: no alert', { summary: decision.summary });
    return {
      shouldAlert: decision.shouldAlert,
      alerted: false,
      dryRun,
      anomalies,
      summary: decision.summary,
    };
  }

  const card = buildAlertCard(anomalies, {
    ...(ctx.projectId !== undefined ? { projectId: ctx.projectId } : {}),
    windowMinutes: ctx.windowMinutes,
  });

  if (dryRun) {
    log('DRY_RUN: would send alert', { anomalies: anomalies.length, color: card.color });
    return { shouldAlert: true, alerted: false, dryRun: true, anomalies, summary: decision.summary };
  }

  const result = await ctx.sender.sendAlert(card, anomalies);
  log(result.sent ? 'alert sent' : 'alert suppressed', {
    suppressed: result.suppressed,
    reason: result.reason,
  });
  return {
    shouldAlert: true,
    alerted: result.sent,
    dryRun: false,
    anomalies,
    summary: decision.summary,
    suppressed: result.suppressed,
  };
}
