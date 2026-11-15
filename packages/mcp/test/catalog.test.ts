/**
 * @purpose Unit tests for MCP catalog compilation and per-connection scoped server execution.
 * @rationale Validates tool discovery, execution, error responses, and output byte limits.
 * @preconditions Vitest test runner.
 * @invariants Assertions must pass with exit code 0.
 */

import { createDefaultConfig, defineAction } from '@shukoi/core';
import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';
import { compileMcpCatalog, createScopedMcpServer } from '../src/shared.js';

describe('MCP Catalog & Scoped Server', () => {
  const echoTool = defineAction({
    name: 'echo',
    description: 'Echoes back text',
    authRequired: false,
    mcp: {
      enabled: true,
      entityType: 'tool',
    },
    input: Type.Object({ text: Type.String() }),
    output: Type.Object({ text: Type.String() }),
    async handler(input) {
      return { text: input.text };
    },
  });

  const heavyTool = defineAction({
    name: 'heavyPayload',
    description: 'Returns payload exceeding byte limit',
    authRequired: false,
    mcp: {
      enabled: true,
      entityType: 'tool',
    },
    input: Type.Object({}),
    output: Type.Object({ data: Type.String() }),
    async handler() {
      // 1000 characters
      return { data: 'A'.repeat(1000) };
    },
  });

  const catalog = compileMcpCatalog([echoTool, heavyTool]);

  it('compiles actions into a frozen catalog with O(1) action lookup', () => {
    expect(catalog.toolsList.length).toBe(2);
    expect(catalog.actionLookup.has('echo')).toBe(true);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.toolsList)).toBe(true);
  });

  it('handles tools/list request and returns registered tools', async () => {
    const config = createDefaultConfig();
    const server = createScopedMcpServer(catalog, { config, headers: {} });

    const response = await server.handleJsonRpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });

    expect(response).toBeDefined();
    expect(response?.id).toBe(1);
    const result = response?.result as { tools: unknown[] };
    expect(result.tools.length).toBe(2);
    await server.close();
  });

  it('executes tools/call and returns text content block', async () => {
    const config = createDefaultConfig();
    const server = createScopedMcpServer(catalog, { config, headers: {} });

    const response = await server.handleJsonRpc({
      jsonrpc: '2.0',
      id: 'req-call-1',
      method: 'tools/call',
      params: {
        name: 'echo',
        arguments: { text: 'Hello MCP!' },
      },
    });

    expect(response).toBeDefined();
    expect(response?.id).toBe('req-call-1');
    const result = response?.result as { content: Array<{ type: string; text: string }> };
    expect(result.content[0]?.type).toBe('text');
    expect(JSON.parse(result.content[0]?.text)).toEqual({ text: 'Hello MCP!' });
    await server.close();
  });

  it('enforces maxMcpOutputBytes and returns structured error if payload exceeds limit', async () => {
    // Set maxMcpOutputBytes to 200 bytes
    const config = createDefaultConfig({
      limits: {
        maxMcpOutputBytes: 200,
      },
    });

    const server = createScopedMcpServer(catalog, { config, headers: {} });

    const response = await server.handleJsonRpc({
      jsonrpc: '2.0',
      id: 'req-heavy',
      method: 'tools/call',
      params: {
        name: 'heavyPayload',
        arguments: {},
      },
    });

    expect(response).toBeDefined();
    const result = response?.result as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('413');
    expect(result.content[0]?.text).toContain('exceeds maximum MCP payload limit');
    await server.close();
  });
});
