/**
 * @purpose Quality Gate 03 (QG-03): Concurrent Stateless MCP HTTP Race Test.
 * @rationale Fires 200 concurrent HTTP POST /mcp tools/call requests with distinct Authorization tokens and simulated latencies, verifying zero cross-request context leakage and zero singleton transport overwrite race conditions.
 * @preconditions @shukoi/mcp/http handler available.
 * @param None
 * @returns Test suite passing with exit code 0.
 * @throws Never throws unhandled; asserts test expectations.
 * @invariants 200 concurrent requests; zero token bleed; zero transport race errors.
 */

import { createDefaultConfig, defineAction } from '@shukoi/core';
import { compileMcpCatalog, createMcpHttpHandler } from '@shukoi/mcp/http';
import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';

describe('QG-03: Concurrent Stateless MCP HTTP Race Test', () => {
  const whoAmITool = defineAction({
    name: 'whoAmI',
    description: 'Echoes back caller token and simulated delay',
    authRequired: false,
    mcp: {
      enabled: true,
      entityType: 'tool',
    },
    input: Type.Object({
      clientId: Type.String(),
      delayMs: Type.Integer({ minimum: 0, maximum: 200 }),
    }),
    output: Type.Object({
      clientId: Type.String(),
      echoedAuthToken: Type.String(),
    }),
    async handler(input, ctx) {
      if (input.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, input.delayMs));
      }
      return {
        clientId: input.clientId,
        echoedAuthToken: ctx.headers.authorization ?? 'none',
      };
    },
  });

  const config = createDefaultConfig({
    security: {
      allowedHosts: ['localhost'],
    },
  });
  const catalog = compileMcpCatalog([whoAmITool]);
  const handler = createMcpHttpHandler(catalog, config);

  it('handles 200 concurrent requests with zero token bleed or transport overwrite errors', async () => {
    const concurrentCount = 200;

    const tasks = Array.from({ length: concurrentCount }, async (_, i) => {
      const clientId = `client-${i}`;
      const token = `Bearer token-secret-${i}`;
      const delayMs = Math.floor(Math.random() * 30); // Random delay 0..30ms

      const req = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          Host: 'localhost',
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `rpc-${i}`,
          method: 'tools/call',
          params: {
            name: 'whoAmI',
            arguments: { clientId, delayMs },
          },
        }),
      });

      const res = await handler(req);
      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        id: string;
        result?: { content: Array<{ text: string }> };
        error?: unknown;
      };

      expect(json.error).toBeUndefined();
      expect(json.result).toBeDefined();

      const parsedContent = JSON.parse(json.result?.content[0]?.text) as {
        clientId: string;
        echoedAuthToken: string;
      };

      // Assert zero cross-contamination: client received its OWN token and ID
      expect(parsedContent.clientId).toBe(clientId);
      expect(parsedContent.echoedAuthToken).toBe(token);
    });

    await Promise.all(tasks);
  });
});
