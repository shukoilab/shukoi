/**
 * @purpose Quality Gate 01 (QG-01): Tri-Transport Parity Test.
 * @rationale Enforces that identical input and error cases executed via direct executeAction(), REST HTTP (app.request()), and MCP (scopedServer.handleJsonRpc()) produce 100% identical domain behavior, stripped output payloads, and error codes.
 * @preconditions @shukoi/core, @shukoi/api, and @shukoi/mcp compiled and available.
 * @param None
 * @returns Test suite passing with exit code 0.
 * @throws Never throws unhandled; asserts test expectations.
 * @invariants Tri-transport parity; zero divergence across protocol adapters.
 */

import { createRestRouter } from '@shukoi/api';
import { createDefaultConfig, DomainError, defineAction, executeAction } from '@shukoi/core';
import { compileMcpCatalog, createScopedMcpServer } from '@shukoi/mcp/http';
import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';

describe('QG-01: Tri-Transport Parity Test', () => {
  const calculateTotal = defineAction({
    name: 'calculateTotal',
    description: 'Calculates order total with discount',
    authRequired: false,
    http: {
      method: 'POST',
      path: '/calculate',
      successStatus: 200,
    },
    mcp: {
      enabled: true,
      entityType: 'tool',
    },
    input: Type.Object({
      amount: Type.Number({ minimum: 0 }),
      discount: Type.Number({ minimum: 0, maximum: 100 }),
    }),
    output: Type.Object({
      finalTotal: Type.Number(),
      appliedDiscount: Type.Number(),
    }),
    async handler(input) {
      const discountAmount = (input.amount * input.discount) / 100;
      return {
        finalTotal: input.amount - discountAmount,
        appliedDiscount: discountAmount,
        internal_audit_secret: 'SHOULD_BE_STRIPPED_BY_CONTRACT',
      } as unknown as { finalTotal: number; appliedDiscount: number };
    },
  });

  const config = createDefaultConfig();
  const catalog = compileMcpCatalog([calculateTotal]);
  const restApp = createRestRouter([calculateTotal], config);

  it('produces identical stripped outputs across executeAction, REST, and MCP on valid inputs', async () => {
    const input = { amount: 200, discount: 15 };
    const expectedOutput = { finalTotal: 170, appliedDiscount: 30 };

    // 1. Direct executeAction
    const directResult = await executeAction(calculateTotal, input, {
      config,
      transport: 'test',
    });
    expect(directResult).toEqual(expectedOutput);
    expect((directResult as Record<string, unknown>).internal_audit_secret).toBeUndefined();

    // 2. REST API (app.request)
    const restRes = await restApp.request('/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(restRes.status).toBe(200);
    const restResult = (await restRes.json()) as typeof expectedOutput;
    expect(restResult).toEqual(expectedOutput);
    expect((restResult as Record<string, unknown>).internal_audit_secret).toBeUndefined();

    // 3. MCP tools/call
    const mcpServer = createScopedMcpServer(catalog, { config, headers: {} });
    const mcpRes = await mcpServer.handleJsonRpc({
      jsonrpc: '2.0',
      id: 'tri-1',
      method: 'tools/call',
      params: {
        name: 'calculateTotal',
        arguments: input,
      },
    });
    const mcpResultObj = mcpRes?.result as { content: Array<{ text: string }> } | undefined;
    const mcpContent = mcpResultObj?.content[0]?.text ?? '{}';
    const mcpResult = JSON.parse(mcpContent) as typeof expectedOutput;
    expect(mcpResult).toEqual(expectedOutput);
    expect((mcpResult as Record<string, unknown>).internal_audit_secret).toBeUndefined();
    await mcpServer.close();
  });

  it('produces identical validation error semantics across executeAction, REST, and MCP on invalid inputs', async () => {
    const invalidInput = { amount: -50, discount: 150 }; // negative amount, discount > 100

    // 1. Direct executeAction: throws DomainError(422)
    await expect(
      executeAction(calculateTotal, invalidInput, { config, transport: 'test' }),
    ).rejects.toThrow(DomainError);

    // 2. REST API: returns 422 with application/problem+json and code VALIDATION_ERROR
    const restRes = await restApp.request('/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidInput),
    });
    expect(restRes.status).toBe(422);
    const problem = (await restRes.json()) as { code: string; status: number };
    expect(problem.code).toBe('VALIDATION_ERROR');
    expect(problem.status).toBe(422);

    // 3. MCP: returns JSON-RPC result with isError: true containing 422
    const mcpServer = createScopedMcpServer(catalog, { config, headers: {} });
    const mcpRes = await mcpServer.handleJsonRpc({
      jsonrpc: '2.0',
      id: 'tri-err',
      method: 'tools/call',
      params: {
        name: 'calculateTotal',
        arguments: invalidInput,
      },
    });
    const mcpResult = mcpRes?.result as { content: Array<{ text: string }>; isError?: boolean };
    expect(mcpResult.isError).toBe(true);
    expect(mcpResult.content[0]?.text).toContain('422');
    expect(mcpResult.content[0]?.text).toContain('Input validation failed');
    await mcpServer.close();
  });
});
