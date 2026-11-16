/**
 * @purpose Unit tests for @shukoi/lambda adapter, typed context extraction, and in-memory testing mocks.
 * @rationale Validates API Gateway v1/v2 event translation, cookie normalization, binary Base64 encoding, stage prefix stripping, dynamic deadline timeouts, and testing doubles.
 * @preconditions Vitest test runner.
 * @invariants Assertions must pass with exit code 0.
 */

import { type ActionExecutionContext, createDefaultConfig, DomainError } from '@shukoi/core';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { defaultIsContentTypeBinary, getLambdaContext, toLambdaHandler } from '../src/index.js';
import {
  createMockApiGatewayV1Event,
  createMockApiGatewayV2Event,
  createMockLambdaContext,
} from '../src/testing.js';

describe('AWS Lambda Adapter', () => {
  it('translates API Gateway v2 HTTP events and dispatches to Hono', async () => {
    const app = new Hono();
    app.post('/api/orders', async (c) => {
      const body = await c.req.json();
      return c.json({ orderId: 'ord-101', received: body });
    });

    const handler = toLambdaHandler(app);
    const mockContext = createMockLambdaContext({
      getRemainingTimeInMillis: () => 15000,
      awsRequestId: 'aws-req-123',
    });

    const mockEvent = createMockApiGatewayV2Event({
      rawPath: '/api/orders',
      httpMethod: 'POST',
      body: JSON.stringify({ item: 'laptop' }),
    });

    const result = await handler(mockEvent, mockContext);
    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.orderId).toBe('ord-101');
    expect(parsed.received).toEqual({ item: 'laptop' });
  });

  it('normalizes ingress and egress cookies in API Gateway v2', async () => {
    const app = new Hono();
    app.get('/api/profile', (c) => {
      const cookieHeader = c.req.header('cookie');
      // Set multiple cookies
      c.header('Set-Cookie', 'sessionId=session-abc-123; Path=/; Secure; HttpOnly');
      c.header('Set-Cookie', 'theme=dark; Path=/', { append: true });
      return c.json({ receivedCookies: cookieHeader });
    });

    const handler = toLambdaHandler(app);
    const mockContext = createMockLambdaContext();
    const mockEvent = createMockApiGatewayV2Event({
      rawPath: '/api/profile',
      httpMethod: 'GET',
      cookies: ['sessionId=existing-token', 'clientVer=2.0'],
    });

    const result = await handler(mockEvent, mockContext);
    expect(result.statusCode).toBe(200);

    // Verify ingress cookie header joined correctly
    const body = JSON.parse(result.body);
    expect(body.receivedCookies).toBe('sessionId=existing-token; clientVer=2.0');

    // Verify egress cookies populated on result.cookies array
    expect(result.cookies).toBeDefined();
    expect(result.cookies).toHaveLength(2);
    expect(result.cookies?.[0]).toContain('sessionId=session-abc-123');
    expect(result.cookies?.[1]).toContain('theme=dark');

    // Verify set-cookie stripped from single headers map to avoid concatenation issues
    expect(result.headers['set-cookie']).toBeUndefined();
  });

  it('automatically detects binary content-type and encodes body as Base64', async () => {
    const app = new Hono();
    const samplePngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    app.get('/assets/logo.png', (c) => {
      c.header('Content-Type', 'image/png');
      return c.body(samplePngBytes.buffer);
    });

    const handler = toLambdaHandler(app);
    const mockContext = createMockLambdaContext();
    const mockEvent = createMockApiGatewayV2Event({
      rawPath: '/assets/logo.png',
      httpMethod: 'GET',
    });

    const result = await handler(mockEvent, mockContext);
    expect(result.statusCode).toBe(200);
    expect(result.isBase64Encoded).toBe(true);

    // Verify body is valid Base64 matching sample bytes
    const decodedBytes = Buffer.from(result.body, 'base64');
    expect(decodedBytes).toEqual(Buffer.from(samplePngBytes));
  });

  it('strips options.basePath and API Gateway v1 stage prefixes', async () => {
    const app = new Hono();
    app.get('/users/profile', (c) => c.json({ user: 'Alice' }));

    // 1. Test options.basePath stripping
    const handlerWithBase = toLambdaHandler(app, { basePath: '/api/v1' });
    const mockContext = createMockLambdaContext();
    const eventWithBase = createMockApiGatewayV2Event({
      rawPath: '/api/v1/users/profile',
      httpMethod: 'GET',
    });

    const resBase = await handlerWithBase(eventWithBase, mockContext);
    expect(resBase.statusCode).toBe(200);
    expect(JSON.parse(resBase.body).user).toBe('Alice');

    // 2. Test API Gateway v1 stage prefix stripping (/prod/users/profile -> /users/profile)
    const handlerStandard = toLambdaHandler(app);
    const eventWithStage = createMockApiGatewayV1Event({
      path: '/prod/users/profile',
      httpMethod: 'GET',
      requestContext: { stage: 'prod' },
    });

    const resStage = await handlerStandard(eventWithStage, mockContext);
    expect(resStage.statusCode).toBe(200);
    expect(JSON.parse(resStage.body).user).toBe('Alice');
  });

  it('merges multiValueHeaders and multiValueQueryStringParameters from API Gateway v1', async () => {
    const app = new Hono();
    app.get('/search', (c) => {
      const q = c.req.query('q');
      const allTags = c.req.queries('tag');
      const customHeader = c.req.header('x-multi-tag');
      return c.json({ q, allTags, customHeader });
    });

    const handler = toLambdaHandler(app);
    const mockContext = createMockLambdaContext();
    const event = createMockApiGatewayV1Event({
      path: '/search',
      httpMethod: 'GET',
      multiValueQueryStringParameters: {
        q: ['shukoi'],
        tag: ['serverless', 'lambda', 'fast'],
      },
      multiValueHeaders: {
        'x-multi-tag': ['alpha', 'beta'],
      },
    });

    const result = await handler(event, mockContext);
    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.q).toBe('shukoi');
    expect(parsed.allTags).toEqual(['serverless', 'lambda', 'fast']);
    expect(parsed.customHeader).toBe('alpha, beta');
  });

  it('aborts immediately with 504 Gateway Timeout if remaining execution time is exhausted', async () => {
    const app = new Hono();
    const config = createDefaultConfig({
      limits: { lambdaDeadlineBufferMs: 500 },
    });
    const handler = toLambdaHandler(app, { config });

    // Only 400ms remaining, which is less than 500ms safety buffer
    const exhaustedContext = createMockLambdaContext({
      getRemainingTimeInMillis: () => 400,
      awsRequestId: 'aws-req-deadline',
    });

    const event = createMockApiGatewayV2Event({
      rawPath: '/api/heavy',
      httpMethod: 'POST',
    });

    const result = await handler(event, exhaustedContext);
    expect(result.statusCode).toBe(504);
    expect(result.headers['Content-Type']).toBe('application/problem+json');
    const parsed = JSON.parse(result.body);
    expect(parsed.code).toBe('GATEWAY_TIMEOUT');
    expect(parsed.detail).toContain('Insufficient Lambda execution time remaining');
  });

  it('extracts strongly typed Lambda context using getLambdaContext helper', () => {
    const mockContext = createMockLambdaContext({
      awsRequestId: 'req-abc-999',
      getRemainingTimeInMillis: () => 24000,
      functionName: 'order-service-fn',
    });
    const mockEvent = createMockApiGatewayV2Event({
      rawPath: '/orders',
    });

    const actionCtx = {
      platform: {
        lambdaContext: mockContext,
        lambdaEvent: mockEvent,
      },
    } as unknown as ActionExecutionContext;

    const lambda = getLambdaContext(actionCtx);
    expect(lambda.context.awsRequestId).toBe('req-abc-999');
    expect(lambda.context.functionName).toBe('order-service-fn');
    expect(lambda.getRemainingTimeInMillis()).toBe(24000);
    expect(lambda.event.rawPath).toBe('/orders');
  });

  it('throws DomainError when getLambdaContext is called outside AWS Lambda', () => {
    const emptyCtx = {
      platform: null,
    } as unknown as ActionExecutionContext;

    expect(() => getLambdaContext(emptyCtx)).toThrowError(DomainError);
    try {
      getLambdaContext(emptyCtx);
    } catch (err: unknown) {
      const domainErr = err as DomainError;
      expect(domainErr.code).toBe('INTERNAL_SERVER_ERROR');
      expect(domainErr.detail).toContain('Lambda context is missing');
    }
  });

  it('correctly evaluates defaultIsContentTypeBinary predicate', () => {
    expect(defaultIsContentTypeBinary('text/plain')).toBe(false);
    expect(defaultIsContentTypeBinary('application/json')).toBe(false);
    expect(defaultIsContentTypeBinary('text/html; charset=utf-8')).toBe(false);
    expect(defaultIsContentTypeBinary('text/css')).toBe(false);
    expect(defaultIsContentTypeBinary('application/problem+json')).toBe(false);

    expect(defaultIsContentTypeBinary('image/png')).toBe(true);
    expect(defaultIsContentTypeBinary('image/jpeg')).toBe(true);
    expect(defaultIsContentTypeBinary('application/pdf')).toBe(true);
    expect(defaultIsContentTypeBinary('application/octet-stream')).toBe(true);
    expect(defaultIsContentTypeBinary('application/zip')).toBe(true);
  });
});
