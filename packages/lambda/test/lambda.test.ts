/**
 * @purpose Unit tests for @shukoi/lambda adapter and dynamic deadline calculation.
 * @rationale Validates remaining execution time subtraction and early 504 Gateway Timeout.
 * @preconditions Vitest test runner.
 * @invariants Assertions must pass with exit code 0.
 */

import { createDefaultConfig } from '@shukoi/core';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { type LambdaContext, type LambdaHttpEvent, toLambdaHandler } from '../src/index.js';

describe('AWS Lambda Adapter', () => {
  it('translates API Gateway v2 HTTP events and dispatches to Hono', async () => {
    const app = new Hono();
    app.post('/api/orders', async (c) => {
      const body = await c.req.json();
      return c.json({ orderId: 'ord-101', received: body });
    });

    const handler = toLambdaHandler(app);
    const mockContext: LambdaContext = {
      getRemainingTimeInMillis: () => 15000,
      awsRequestId: 'aws-req-123',
    };

    const mockEvent: LambdaHttpEvent = {
      version: '2.0',
      rawPath: '/api/orders',
      requestContext: {
        http: { method: 'POST', path: '/api/orders' },
      },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item: 'laptop' }),
      isBase64Encoded: false,
    };

    const result = await handler(mockEvent, mockContext);
    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.orderId).toBe('ord-101');
    expect(parsed.received).toEqual({ item: 'laptop' });
  });

  it('aborts immediately with 504 Gateway Timeout if remaining execution time is exhausted', async () => {
    const app = new Hono();
    const config = createDefaultConfig({
      limits: { lambdaDeadlineBufferMs: 500 },
    });
    const handler = toLambdaHandler(app, { config });

    // Only 400ms remaining, which is less than 500ms safety buffer
    const exhaustedContext: LambdaContext = {
      getRemainingTimeInMillis: () => 400,
      awsRequestId: 'aws-req-deadline',
    };

    const event: LambdaHttpEvent = {
      rawPath: '/api/heavy',
      httpMethod: 'POST',
    };

    const result = await handler(event, exhaustedContext);
    expect(result.statusCode).toBe(504);
    const parsed = JSON.parse(result.body);
    expect(parsed.code).toBe('GATEWAY_TIMEOUT');
    expect(parsed.detail).toContain('Insufficient Lambda execution time remaining');
  });
});
