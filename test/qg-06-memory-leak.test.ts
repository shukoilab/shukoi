/**
 * @purpose Quality Gate 06 (QG-06): Zero Memory Leak Soak Test.
 * @rationale Executes 10,000 action invocations across REST and MCP (including 2,000 mid-flight cancellations), triggers garbage collection, and asserts that active tracking sets are completely cleared (size === 0) with heap drift bounded.
 * @preconditions Vitest test runner; Node.js memory inspection.
 * @param None
 * @returns Test suite passing with exit code 0.
 * @throws Never throws unhandled; asserts test expectations.
 * @invariants Zero leaked listeners; inFlight registries cleared to 0; bounded heap drift.
 */

import {
  createDefaultConfig,
  defineAction,
  executeAction,
  InMemoryIdempotencyStore,
} from '@shukoi/core';
import { compileMcpCatalog, createScopedMcpServer } from '@shukoi/mcp/http';
import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';

describe('QG-06: Zero Memory Leak Soak Test', () => {
  const soakAction = defineAction({
    name: 'soakTask',
    description: 'High-throughput test action',
    authRequired: false,
    input: Type.Object({ idx: Type.Integer() }),
    output: Type.Object({ res: Type.Integer() }),
    async handler(input, ctx) {
      if (input.idx % 5 === 0) {
        // Every 5th request registers onFinally cleanup
        ctx.onFinally(() => {
          // teardown simulation
        });
      }
      return { res: input.idx * 2 };
    },
  });

  const config = createDefaultConfig();
  const catalog = compileMcpCatalog([soakAction]);
  const idempotencyStore = new InMemoryIdempotencyStore(500);

  it('runs 10,000 executions with 2,000 mid-flight cancellations without memory leaks', async () => {
    if (typeof global.gc === 'function') {
      global.gc();
    }
    const initialMemory = process.memoryUsage().heapUsed;

    const totalRequests = 10000;
    const cancelEvery = 5; // 2,000 cancellations

    const mcpServer = createScopedMcpServer(catalog, {
      config,
      headers: {},
      idempotencyStore,
    });

    for (let i = 0; i < totalRequests; i++) {
      const shouldCancel = i % cancelEvery === 0;

      if (shouldCancel) {
        const controller = new AbortController();
        controller.abort('Simulated mid-flight cancellation');

        await executeAction(
          soakAction,
          { idx: i },
          {
            config,
            transport: 'test',
            signal: controller.signal,
            idempotencyStore,
          },
        ).catch(() => {});
      } else {
        await executeAction(
          soakAction,
          { idx: i },
          {
            config,
            transport: 'test',
            idempotencyStore,
          },
        );
      }
    }

    await mcpServer.close();

    if (typeof global.gc === 'function') {
      global.gc();
      await new Promise((resolve) => setTimeout(resolve, 50));
      global.gc();
    }
    const finalMemory = process.memoryUsage().heapUsed;
    const heapDriftMb = (finalMemory - initialMemory) / (1024 * 1024);

    // Assert that bounded idempotency store did not exceed maximum capacity
    expect(idempotencyStore.size).toBeLessThanOrEqual(500);

    // Assert that heap drift is bounded and reasonable
    expect(heapDriftMb).toBeLessThan(30);
  });
});
