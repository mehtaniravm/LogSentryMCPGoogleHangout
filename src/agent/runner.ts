import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ALL_TOOLS } from '../mcp/tools/index.js';
import type { ToolDeps } from '../mcp/tools/types.js';

/** Minimal content-block shapes from the Anthropic Messages API we consume. */
export interface TextBlock {
  type: 'text';
  text: string;
}
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}
export type ContentBlock = TextBlock | ToolUseBlock | { type: string; [k: string]: unknown };

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: unknown;
}

export interface AnthropicResponse {
  content: ContentBlock[];
  stop_reason: string | null;
}

/** The subset of the Anthropic SDK we depend on (so tests can inject a fake). */
export interface AnthropicLike {
  messages: {
    create(body: {
      model: string;
      max_tokens: number;
      system?: string;
      tools?: unknown[];
      messages: AnthropicMessage[];
    }): Promise<AnthropicResponse>;
  };
}

/** Convert our MCP tools into Anthropic tool definitions (JSON Schema input). */
export function toAnthropicTools(): Array<{ name: string; description: string; input_schema: unknown }> {
  return ALL_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: zodToJsonSchema(z.object(t.inputSchema), { target: 'openApi3' }),
  }));
}

export interface RunAgentOptions {
  client: AnthropicLike;
  model: string;
  system: string;
  messages: AnthropicMessage[];
  deps: ToolDeps;
  maxSteps?: number;
  maxTokens?: number;
}

export interface AgentRunResult {
  text: string;
  toolsUsed: string[];
  steps: number;
}

const toolByName = new Map(ALL_TOOLS.map((t) => [t.name, t]));

/**
 * Run an agentic loop: call Claude with the MCP tools; whenever it requests a
 * tool, execute it against `deps` and feed the result back, until Claude stops
 * requesting tools or `maxSteps` is reached. Returns the final assistant text.
 */
export async function runAgent(opts: RunAgentOptions): Promise<AgentRunResult> {
  const tools = toAnthropicTools();
  const messages: AnthropicMessage[] = [...opts.messages];
  const toolsUsed: string[] = [];
  const maxSteps = opts.maxSteps ?? 6;

  for (let step = 1; step <= maxSteps; step++) {
    const res = await opts.client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      tools,
      messages,
    });

    const toolUses = res.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || toolUses.length === 0) {
      const text = res.content
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { text, toolsUsed, steps: step };
    }

    // Record the assistant turn, then execute each requested tool.
    messages.push({ role: 'assistant', content: res.content });
    const toolResults: unknown[] = [];
    for (const use of toolUses) {
      toolsUsed.push(use.name);
      const tool = toolByName.get(use.name);
      let payload: string;
      let isError = false;
      if (!tool) {
        payload = `Unknown tool: ${use.name}`;
        isError = true;
      } else {
        try {
          payload = JSON.stringify(await tool.handler(use.input, opts.deps));
        } catch (err) {
          payload = `Error: ${(err as Error).message}`;
          isError = true;
        }
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: payload,
        ...(isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return { text: '', toolsUsed, steps: maxSteps };
}
