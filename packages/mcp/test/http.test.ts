/**
 * @purpose Unit tests for @shukoi/mcp/http DNS-rebinding protection and stateless HTTP transport.
 * @rationale Validates Host/Origin pinning and JSON-RPC over HTTP execution.
 * @preconditions Vitest test runner.
 * @invariants Assertions must pass with exit code 0.
 */

import { createDefaultConfig, defineAction } from '@shukoi/core';
import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';
import { createMcpHttpHandler } from '../src/http.js';
import { compileMcpCatalog } from '../src/shared.js';

describe('MCP HTTP Transport & DNS-Rebinding Protection', () => {
  const tool = defineAction({
    name: 'pingTool',
    description: 'Pings back',
    authRequired: false,
    mcp: {
      enabled: true,
      entityType: 'tool',
    },
    input: Type.Object({}),
    output: Type.Object({ pong: Type.Boolean() }),
    async handler() {
      return { pong: true };
    },
  });

  const catalog = compileMcpCatalog([tool]);

  it('rejects requests with unapproved Host headers with 403 Forbidden (DNS-rebinding protection)', async () => {
    const config = createDefaultConfig({
      security: {
        allowedHosts: ['localhost', '127.0.0.1'],
      },
    });

    const handler = createMcpHttpHandler(catalog, config);

    const evilReq = new Request('http://evil.com/mcp', {
      method: 'POST',
      headers: {
        Host: 'evil.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    const res = await handler(evilReq);
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBeDefined();
  });

  it('rejects requests with unapproved Origin headers with 403 Forbidden', async () => {
    const config = createDefaultConfig({
      security: {
        allowedHosts: ['localhost'],
        allowedOrigins: ['https://trusted.example.com'],
      },
    });

    const handler = createMcpHttpHandler(catalog, config);

    const evilOriginReq = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        Host: 'localhost',
        Origin: 'https://evil-site.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    const res = await handler(evilOriginReq);
    expect(res.status).toBe(403);
  });

  it('successfully handles valid MCP HTTP POST requests from allowed host', async () => {
    const config = createDefaultConfig({
      security: {
        allowedHosts: ['localhost'],
        allowedOrigins: ['*'],
      },
    });

    const handler = createMcpHttpHandler(catalog, config);

    const validReq = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        Host: 'localhost',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'call-1',
        method: 'tools/call',
        params: { name: 'pingTool', arguments: {} },
      }),
    });

    const res = await handler(validReq);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { content: Array<{ text: string }> } };
    expect(JSON.parse(body.result.content[0]?.text)).toEqual({ pong: true });
  });

  it('processes batch JSON-RPC requests within batch limits', async () => {
    const config = createDefaultConfig({
      security: { allowedHosts: ['localhost'] },
    });

    const handler = createMcpHttpHandler(catalog, config);

    const batchReq = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        Host: 'localhost',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      ]),
    });

    const res = await handler(batchReq);
    expect(res.status).toBe(200);
    const responses = (await res.json()) as unknown[];
    expect(responses.length).toBe(2);
  });
});
