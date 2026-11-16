/**
 * @purpose Unit tests for createRestRouter, CORS handling, parameter merging priority, and RFC 9457 error serialization.
 * @rationale Enforces that path parameters always win over body and query, and errors return application/problem+json.
 * @preconditions Vitest test runner.
 * @invariants Assertions must pass with exit code 0.
 */

import { createDefaultConfig, defineAction, InMemoryIdempotencyStore } from '@shukoi/core';
import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';
import { coercePrimitiveParam, createRestRouter } from '../src/router.js';

describe('createRestRouter', () => {
  it('safely coerces primitives while strictly preserving leading-zero numeric strings', () => {
    // Booleans
    expect(coercePrimitiveParam('true')).toBe(true);
    expect(coercePrimitiveParam('false')).toBe(false);

    // Leading zeros: MUST NOT coerce to number to preserve postal codes / phone numbers
    expect(coercePrimitiveParam('01234')).toBe('01234');
    expect(coercePrimitiveParam('007')).toBe('007');

    // Clean numbers
    expect(coercePrimitiveParam('0')).toBe(0);
    expect(coercePrimitiveParam('42')).toBe(42);
    expect(coercePrimitiveParam('-100')).toBe(-100);
    expect(coercePrimitiveParam('12.34')).toBe(12.34);
    expect(coercePrimitiveParam('-0.5')).toBe(-0.5);

    // Text strings
    expect(coercePrimitiveParam('hello')).toBe('hello');
    expect(coercePrimitiveParam('')).toBe('');
  });

  it('enforces deterministic parameter merge priority: Query < Body < Path', async () => {
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

  it('serializes unmapped 404 routes into standard RFC 9457 Problem Details', async () => {
    const config = createDefaultConfig();
    const app = createRestRouter([], config);

    const res = await app.request('/api/v1/non-existent-route', {
      method: 'GET',
    });

    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toContain('application/problem+json');
    const problem = (await res.json()) as Record<string, unknown>;
    expect(problem.code).toBe('NOT_FOUND');
    expect(problem.status).toBe(404);
    expect(problem.title).toBe('NOT FOUND');
    expect(problem.detail).toContain('Route "GET /api/v1/non-existent-route" not found');
    expect(problem.requestId).toBeDefined();
  });

  it('parses multi-value array query parameters cleanly', async () => {
    const action = defineAction({
      name: 'filterProducts',
      description: 'Filters products by tags and zip code',
      authRequired: false,
      http: {
        method: 'GET',
        path: '/products',
        successStatus: 200,
      },
      input: Type.Object({
        tags: Type.Array(Type.String()),
        zipCode: Type.String(),
      }),
      output: Type.Object({
        tagsCount: Type.Number(),
        receivedTags: Type.Array(Type.String()),
        zipCode: Type.String(),
      }),
      async handler(input) {
        return {
          tagsCount: input.tags.length,
          receivedTags: input.tags,
          zipCode: input.zipCode,
        };
      },
    });

    const config = createDefaultConfig();
    const app = createRestRouter([action], config);

    const res = await app.request('/products?tags=electronics&tags=audio&zipCode=01234');
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      tagsCount: number;
      receivedTags: string[];
      zipCode: string;
    };
    expect(data.tagsCount).toBe(2);
    expect(data.receivedTags).toEqual(['electronics', 'audio']);
    // Leading zero preserved as string
    expect(data.zipCode).toBe('01234');
  });

  it('respects action customContentType for non-JSON responses', async () => {
    const csvAction = defineAction({
      name: 'exportCsv',
      description: 'Exports CSV report',
      authRequired: false,
      http: {
        method: 'GET',
        path: '/report.csv',
        successStatus: 200,
        customContentType: 'text/csv',
      },
      input: Type.Object({}),
      output: Type.String(),
      async handler() {
        return 'id,name,role\n1,Alice,Admin\n2,Bob,User';
      },
    });

    const config = createDefaultConfig();
    const app = createRestRouter([csvAction], config);

    const res = await app.request('/report.csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv');
    const text = await res.text();
    expect(text).toContain('id,name,role');
  });

  it('emits Idempotent-Replayed header on replayed idempotent executions', async () => {
    const mutateAction = defineAction({
      name: 'transferMoney',
      description: 'Transfers funds idempotently',
      authRequired: false,
      http: {
        method: 'POST',
        path: '/transfers',
        successStatus: 201,
        requireIdempotencyKey: true,
      },
      input: Type.Object({ amount: Type.Number() }),
      output: Type.Object({ success: Type.Boolean(), transferId: Type.String() }),
      async handler(input) {
        return { success: true, transferId: `tx-${input.amount}` };
      },
    });

    const config = createDefaultConfig();
    const idempotencyStore = new InMemoryIdempotencyStore();
    const app = createRestRouter([mutateAction], config, { idempotencyStore });

    // First request: acquired and completed
    const res1 = await app.request('/transfers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'key-tx-100',
      },
      body: JSON.stringify({ amount: 100 }),
    });
    expect(res1.status).toBe(201);
    expect(res1.headers.get('Idempotent-Replayed')).toBeNull();

    // Second request: replayed from cache
    const res2 = await app.request('/transfers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'key-tx-100',
      },
      body: JSON.stringify({ amount: 100 }),
    });
    expect(res2.status).toBe(201);
    expect(res2.headers.get('Idempotent-Replayed')).toBe('true');
    const data2 = (await res2.json()) as { success: boolean; transferId: string };
    expect(data2.transferId).toBe('tx-100');
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
