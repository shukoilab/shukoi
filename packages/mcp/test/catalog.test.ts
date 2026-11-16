/**
 * @purpose Unit tests for MCP catalog compilation and per-connection scoped server execution.
 * @rationale Validates tool discovery, execution, resources read, prompts get, and output byte limits.
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

  const rawStringTool = defineAction({
    name: 'rawString',
    description: 'Returns raw text string directly',
    authRequired: false,
    mcp: {
      enabled: true,
      entityType: 'tool',
    },
    input: Type.Object({}),
    output: Type.String(),
    async handler() {
      return 'Simple text response';
    },
  });

  const customContentTool = defineAction({
    name: 'customContent',
    description: 'Returns pre-formatted MCP content blocks',
    authRequired: false,
    mcp: {
      enabled: true,
      entityType: 'tool',
    },
    input: Type.Object({}),
    output: Type.Object({
      content: Type.Array(
        Type.Object({
          type: Type.String(),
          text: Type.Optional(Type.String()),
          data: Type.Optional(Type.String()),
          mimeType: Type.Optional(Type.String()),
        }),
      ),
    }),
    async handler() {
      return {
        content: [
          { type: 'text', text: 'Section 1' },
          { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
        ],
      };
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

  const statusResource = defineAction({
    name: 'serverStatus',
    description: 'Current server status metrics',
    authRequired: false,
    mcp: {
      enabled: true,
      entityType: 'resource',
      mimeType: 'application/json',
    },
    input: Type.Object({}),
    output: Type.Object({ status: Type.String(), uptime: Type.Number() }),
    async handler() {
      return { status: 'healthy', uptime: 3600 };
    },
  });

  const nodeMetricsTemplateResource = defineAction({
    name: 'nodeMetrics',
    description: 'Parameterized cluster node metrics',
    authRequired: false,
    mcp: {
      enabled: true,
      entityType: 'resource',
      resourceUriTemplate: 'cluster://{clusterId}/nodes/{nodeId}',
      mimeType: 'application/json',
    },
    input: Type.Object({
      clusterId: Type.String(),
      nodeId: Type.String(),
    }),
    output: Type.Object({
      cluster: Type.String(),
      node: Type.String(),
      cpuUsage: Type.Number(),
    }),
    async handler(input) {
      return {
        cluster: input.clusterId,
        node: input.nodeId,
        cpuUsage: 42.5,
      };
    },
  });

  const codeReviewPrompt = defineAction({
    name: 'codeReview',
    description: 'Comprehensive code review prompt',
    authRequired: false,
    mcp: {
      enabled: true,
      entityType: 'prompt',
    },
    input: Type.Object({
      language: Type.String({ description: 'Target programming language' }),
      code: Type.String({ description: 'Source code snippet to analyze' }),
      focus: Type.Optional(Type.String({ description: 'Optional focal area' })),
    }),
    output: Type.Object({
      description: Type.Optional(Type.String()),
      messages: Type.Array(
        Type.Object({
          role: Type.String(),
          content: Type.Object({ type: Type.String(), text: Type.String() }),
        }),
      ),
    }),
    async handler(input) {
      return {
        description: `Review prompt for ${input.language}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Review the following ${input.language} code: \n\n${input.code}`,
            },
          },
        ],
      };
    },
  });

  const catalog = compileMcpCatalog([
    echoTool,
    rawStringTool,
    customContentTool,
    heavyTool,
    statusResource,
    nodeMetricsTemplateResource,
    codeReviewPrompt,
  ]);

  it('compiles actions into a frozen catalog with O(1) action, resource, and prompt lookups', () => {
    expect(catalog.toolsList.length).toBe(4);
    expect(catalog.resourcesList.length).toBe(1);
    expect(catalog.resourceTemplatesList.length).toBe(1);
    expect(catalog.promptsList.length).toBe(1);

    expect(catalog.actionLookup.has('echo')).toBe(true);
    expect(catalog.resourceLookup.has('resource://serverStatus')).toBe(true);
    expect(catalog.resourceTemplateLookup.length).toBe(1);
    expect(catalog.resourceTemplateLookup[0]?.template).toBe(
      'cluster://{clusterId}/nodes/{nodeId}',
    );

    // Verify prompt argument schema extraction
    const promptDesc = catalog.promptsList[0];
    expect(promptDesc?.name).toBe('codeReview');
    expect(promptDesc?.arguments?.length).toBe(3);

    const langArg = promptDesc?.arguments?.find((a) => a.name === 'language');
    expect(langArg?.description).toBe('Target programming language');
    expect(langArg?.required).toBe(true);

    const focusArg = promptDesc?.arguments?.find((a) => a.name === 'focus');
    expect(focusArg?.required).toBe(false);

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
    expect(result.tools.length).toBe(4);
    await server.close();
  });

  it('executes tools/call with standard serialization, raw strings, and pre-formatted content', async () => {
    const config = createDefaultConfig();
    const server = createScopedMcpServer(catalog, { config, headers: {} });

    // 1. Standard Object Tool
    const res1 = await server.handleJsonRpc({
      jsonrpc: '2.0',
      id: 'req-call-1',
      method: 'tools/call',
      params: {
        name: 'echo',
        arguments: { text: 'Hello MCP!' },
      },
    });
    const result1 = res1?.result as { content: Array<{ type: string; text: string }> };
    expect(result1.content[0]?.type).toBe('text');
    expect(JSON.parse(result1.content[0]?.text ?? '{}')).toEqual({ text: 'Hello MCP!' });

    // 2. Raw String Tool
    const res2 = await server.handleJsonRpc({
      jsonrpc: '2.0',
      id: 'req-call-2',
      method: 'tools/call',
      params: {
        name: 'rawString',
        arguments: {},
      },
    });
    const result2 = res2?.result as { content: Array<{ type: string; text: string }> };
    expect(result2.content[0]?.text).toBe('Simple text response');

    // 3. Pre-formatted Content Blocks
    const res3 = await server.handleJsonRpc({
      jsonrpc: '2.0',
      id: 'req-call-3',
      method: 'tools/call',
      params: {
        name: 'customContent',
        arguments: {},
      },
    });
    const result3 = res3?.result as {
      content: Array<{ type: string; text?: string; data?: string }>;
    };
    expect(result3.content.length).toBe(2);
    expect(result3.content[0]?.text).toBe('Section 1');
    expect(result3.content[1]?.data).toBe('aGVsbG8=');

    await server.close();
  });

  it('enforces maxMcpOutputBytes and returns structured error if payload exceeds limit', async () => {
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

  it('handles resources/list, resources/templates/list, and resources/read with URI resolution', async () => {
    const config = createDefaultConfig();
    const server = createScopedMcpServer(catalog, { config, headers: {} });

    // 1. resources/list
    const listRes = await server.handleJsonRpc({
      jsonrpc: '2.0',
      id: 'res-list',
      method: 'resources/list',
    });
    const listResult = listRes?.result as { resources: Array<{ uri: string }> };
    expect(listResult.resources.length).toBe(1);
    expect(listResult.resources[0]?.uri).toBe('resource://serverStatus');

    // 2. resources/templates/list
    const tplRes = await server.handleJsonRpc({
      jsonrpc: '2.0',
      id: 'tpl-list',
      method: 'resources/templates/list',
    });
    const tplResult = tplRes?.result as { resourceTemplates: Array<{ uriTemplate: string }> };
    expect(tplResult.resourceTemplates.length).toBe(1);
    expect(tplResult.resourceTemplates[0]?.uriTemplate).toBe(
      'cluster://{clusterId}/nodes/{nodeId}',
    );

    // 3. resources/read - exact URI match
    const readDirect = await server.handleJsonRpc({
      jsonrpc: '2.0',
      id: 'read-direct',
      method: 'resources/read',
      params: { uri: 'resource://serverStatus' },
    });
    expect(readDirect?.error).toBeUndefined();
    const directResult = readDirect?.result as {
      contents: Array<{ uri: string; text: string; mimeType: string }>;
    };
    expect(directResult.contents[0]?.uri).toBe('resource://serverStatus');
    expect(directResult.contents[0]?.mimeType).toBe('application/json');
    expect(JSON.parse(directResult.contents[0]?.text ?? '{}')).toEqual({
      status: 'healthy',
      uptime: 3600,
    });

    // 4. resources/read - template match with param extraction
    const readTpl = await server.handleJsonRpc({
      jsonrpc: '2.0',
      id: 'read-tpl',
      method: 'resources/read',
      params: { uri: 'cluster://us-west-2/nodes/worker-09' },
    });
    expect(readTpl?.error).toBeUndefined();
    const tplReadResult = readTpl?.result as {
      contents: Array<{ uri: string; text: string; mimeType: string }>;
    };
    expect(tplReadResult.contents[0]?.uri).toBe('cluster://us-west-2/nodes/worker-09');
    expect(JSON.parse(tplReadResult.contents[0]?.text ?? '{}')).toEqual({
      cluster: 'us-west-2',
      node: 'worker-09',
      cpuUsage: 42.5,
    });

    // 5. resources/read - missing uri error
    const errMissing = await server.handleJsonRpc({
      jsonrpc: '2.0',
      id: 'read-err-1',
      method: 'resources/read',
      params: {},
    });
    expect(errMissing?.error?.code).toBe(-32602);
    expect(errMissing?.error?.message).toContain('missing uri');

    // 6. resources/read - not found error
    const errNotFound = await server.handleJsonRpc({
      jsonrpc: '2.0',
      id: 'read-err-2',
      method: 'resources/read',
      params: { uri: 'resource://unknownEntity' },
    });
    expect(errNotFound?.error?.code).toBe(-32602);
    expect(errNotFound?.error?.message).toContain('not found');

    await server.close();
  });

  it('handles prompts/list and prompts/get with argument forwarding and formatting', async () => {
    const config = createDefaultConfig();
    const server = createScopedMcpServer(catalog, { config, headers: {} });

    // 1. prompts/list
    const listRes = await server.handleJsonRpc({
      jsonrpc: '2.0',
      id: 'prompt-list',
      method: 'prompts/list',
    });
    const listResult = listRes?.result as { prompts: Array<{ name: string }> };
    expect(listResult.prompts.length).toBe(1);
    expect(listResult.prompts[0]?.name).toBe('codeReview');

    // 2. prompts/get - valid arguments
    const getRes = await server.handleJsonRpc({
      jsonrpc: '2.0',
      id: 'prompt-get-1',
      method: 'prompts/get',
      params: {
        name: 'codeReview',
        arguments: {
          language: 'TypeScript',
          code: 'const x: number = 42;',
        },
      },
    });
    expect(getRes?.error).toBeUndefined();
    const getResult = getRes?.result as {
      description: string;
      messages: Array<{ role: string; content: { type: string; text: string } }>;
    };
    expect(getResult.description).toBe('Review prompt for TypeScript');
    expect(getResult.messages[0]?.role).toBe('user');
    expect(getResult.messages[0]?.content.text).toContain('const x: number = 42;');

    // 3. prompts/get - missing name parameter
    const errMissingName = await server.handleJsonRpc({
      jsonrpc: '2.0',
      id: 'prompt-err-1',
      method: 'prompts/get',
      params: {},
    });
    expect(errMissingName?.error?.code).toBe(-32602);
    expect(errMissingName?.error?.message).toContain('missing prompt name');

    // 4. prompts/get - prompt not found
    const errNotFound = await server.handleJsonRpc({
      jsonrpc: '2.0',
      id: 'prompt-err-2',
      method: 'prompts/get',
      params: { name: 'nonExistentPrompt' },
    });
    expect(errNotFound?.error?.code).toBe(-32602);
    expect(errNotFound?.error?.message).toContain('not found');

    await server.close();
  });
});
