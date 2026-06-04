import { describe, it, expect, beforeAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { fakeLogging, fakeDeps } from '../fixtures/deps.js';
import { makeEntries, makeEntry } from '../fixtures/logEntries.js';
import type { LogEntry } from '../../src/logging/types.js';

const EXPECTED_TOOLS = [
  'list_services',
  'query_logs',
  'get_service_health',
  'find_anomalies',
  'get_error_summary',
];

async function connectedClient() {
  const entries: LogEntry[] = [...makeEntries(60, 'INFO'), makeEntry({ severity: 'ERROR', message: 'boom 1' })];
  const deps = fakeDeps(
    fakeLogging({
      listServices: () => ['payment-service', 'cart-service'],
      queryLogs: () => entries,
    }),
  );
  const server = createMcpServer(deps);
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('MCP server', () => {
  let client: Client;
  beforeAll(async () => {
    client = await connectedClient();
  });

  it('lists exactly the 5 expected tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it('each tool returns a well-formed result over the transport', async () => {
    for (const name of EXPECTED_TOOLS) {
      const res = await client.callTool({ name, arguments: { service: 'payment-service' } });
      expect(res.isError).not.toBe(true);
      const content = res.content as Array<{ type: string; text: string }>;
      expect(content[0]?.type).toBe('text');
      // payload parses as JSON
      expect(() => JSON.parse(content[0]!.text)).not.toThrow();
    }
  });

  it('list_services returns the injected service names', async () => {
    const res = await client.callTool({ name: 'list_services', arguments: {} });
    const content = res.content as Array<{ text: string }>;
    expect(JSON.parse(content[0]!.text)).toEqual(['payment-service', 'cart-service']);
  });

  it('returns a structured error (not a crash) on invalid input', async () => {
    const res = await client.callTool({
      name: 'query_logs',
      arguments: { windowMinutes: 99999 }, // exceeds max 1440
    });
    expect(res.isError).toBe(true);
  });
});
