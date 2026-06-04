import express, { type Express, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Env } from './config/env.js';
import { createMcpServer } from './mcp/server.js';
import { createChatBotHandler, createDefaultVerifier } from './chat/bot.js';
import { runMonitorCycle } from './agent/monitor.js';
import { createAlertSender, type AlertSender } from './chat/webhook.js';
import { buildToolDeps, buildAnthropic } from './runtime/clients.js';
import type { ToolDeps } from './mcp/tools/types.js';
import type { AnthropicLike } from './agent/runner.js';

export interface AppContext {
  env: Env;
  deps: ToolDeps;
  anthropic: AnthropicLike;
  sender: AlertSender;
}

/** Build the AppContext from the validated environment. */
export function buildAppContext(env: Env): AppContext {
  return {
    env,
    deps: buildToolDeps(env),
    anthropic: buildAnthropic(env),
    sender: createAlertSender({
      ...(env.GOOGLE_CHAT_WEBHOOK_URL !== undefined
        ? { webhookUrl: env.GOOGLE_CHAT_WEBHOOK_URL }
        : {}),
      cooldownMinutes: env.ALERT_COOLDOWN_MINUTES,
    }),
  };
}

/**
 * Build the Express app: health check, Google Chat bot route, monitor trigger,
 * and a stateless MCP HTTP endpoint.
 */
export function createApp(ctx: AppContext): Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Google Chat inbound Q&A bot.
  const chatHandler = createChatBotHandler({
    anthropic: ctx.anthropic,
    model: ctx.env.ANTHROPIC_MODEL,
    deps: ctx.deps,
    verify: createDefaultVerifier(ctx.env.GOOGLE_CHAT_AUDIENCE),
    timeoutMs: 25_000,
    onFollowUp: async (card) => {
      await ctx.sender.postCard(card);
    },
  });
  app.post('/chat', (req, res) => {
    void chatHandler(req, res);
  });

  // Scheduler heartbeat. VERIFY: enforce Cloud Scheduler OIDC audience here in prod.
  app.post('/monitor', async (_req, res) => {
    const outcome = await runMonitorCycle({
      anthropic: ctx.anthropic,
      model: ctx.env.ANTHROPIC_MODEL,
      deps: ctx.deps,
      sender: ctx.sender,
      windowMinutes: ctx.env.DEFAULT_WINDOW_MINUTES,
      projectId: ctx.env.GCP_PROJECT_ID,
      dryRun: ctx.env.DRY_RUN,
      logger: (msg, meta) => console.log(`[monitor] ${msg}`, meta ?? ''),
    });
    res.json(outcome);
  });

  // Stateless MCP over HTTP (one server+transport per request).
  app.post('/mcp', async (req: Request, res: Response) => {
    const server = createMcpServer(ctx.deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  return app;
}
