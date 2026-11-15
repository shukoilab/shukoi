/**
 * @purpose Unit tests for createRestRouter, CORS handling, parameter merging priority, and RFC 9457 error serialization.
 * @rationale Enforces that path parameters always win over body and query, and errors return application/problem+json.
 * @preconditions Vitest test runner.
 * @invariants Assertions must pass with exit code 0.
 */

import { createDefaultConfig, defineAction } from '@shukoi/core';
import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';
import { createRestRouter } from '../src/router.js';

describe('createRestRouter', () => {
  it('enforces deterministic parameter merge priority: Query < Body < Path', async () => {
    // Action where id is expected from path, but attacker also supplies id in query and body
    const action = defineAction({
      name: 'updateOrder',
      description: 'Updates order',
      authRequired: false,
      http: {
        method: 'POST',
        path: '/orders/:id',
        successStatus: 200,
      },
      input: Type.Object({
        id: Type.String(),
        status: Type.String(),
      }),
      output: Type.Object({
        id: Type.String(),
        status: Type.String(),
      }),
      async handler(input) {
        return { id: input.id, status: input.status };
      },
    });

    const config = createDefaultConfig();
    const app = createRestRouter([action], config);

    // Request with:
    // Path parameter: id = "path-id"
    // Query parameter: id = "query-id"
    // Body: { id: "body-id", status: "confirmed" }
    const res = await app.request('/orders/path-id?id=query-id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'body-id', status: 'confirmed' }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { id: string; status: string };
    // Path parameter MUST win
    expect(data.id).toBe('path-id');
    expect(data.status).toBe('confirmed');
  });

  it('serializes validation errors to RFC 9457 Problem Details with application/problem+json', async () => {
    const action = defineAction({
      name: 'createItem',
      description: 'Creates item',
      authRequired: false,
      http: {
        method: 'POST',
        path: '/items',
        successStatus: 201,
      },
      input: Type.Object({ name: Type.String({ minLength: 3 }) }),
      output: Type.Object({ id: Type.String() }),
      async handler() {
        return { id: 'item-1' };
      },
    });

    const config = createDefaultConfig();
    const app = createRestRouter([action], config);

    const res = await app.request('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ab' }), // too short
    });

    expect(res.status).toBe(422);
    expect(res.headers.get('Content-Type')).toContain('application/problem+json');
    const problem = (await res.json()) as Record<string, unknown>;
    expect(problem.code).toBe('VALIDATION_ERROR');
    expect(problem.status).toBe(422);
    expect(problem.detail).toBeDefined();
    expect(problem.requestId).toBeDefined();
  });

  it('handles CORS preflight OPTIONS requests gracefully', async () => {
    const config = createDefaultConfig({
      security: {
        allowedOrigins: ['https://app.example.com'],
      },
    });
    const app = createRestRouter([], config);

    const res = await app.request('/openapi.json', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.example.com',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
  });
});
