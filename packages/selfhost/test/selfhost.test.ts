/**
 * @purpose Unit tests for @shukoi/selfhost adapter, health probes, OOM body limits, and graceful drain state machine.
 * @rationale Validates /healthz probes, dynamic isReady callback, stream-bounded body protection (413), multi-cookie preservation, and testing doubles.
 * @preconditions Vitest test runner.
 * @invariants Assertions must pass with exit code 0.
 */

import { type ActionExecutionContext, createDefaultConfig, DomainError } from '@shukoi/core';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createSelfHostServer, getSelfHostContext } from '../src/index.js';
import { createMockSelfHostContext } from '../src/testing.js';

describe('Self-Host Server Adapter', () => {
  it('serves /healthz/live (200) and /healthz/ready (200), then flips readiness to 503 on drain', async () => {
    let releaseSlowRequest: () => void = () => {};
    const slowRequestPromise = new Promise<void>((resolve) => {
      releaseSlowRequest = resolve;
    });

    const app = new Hono();
    app.get('/hello', (c) => c.json({ message: 'world' }));
    app.get('/slow', async (c) => {
      await slowRequestPromise;
      return c.json({ ok: true });
    });

    const config = createDefaultConfig();
    const port = 34567; // distinct test port
    const serverHandle = createSelfHostServer(app, config, { port, shutdownGracePeriodMs: 500 });

    // Allow server to bind
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(serverHandle.getState()).toBe('HEALTHY');

    // 1. Probe /healthz/live
    const liveRes = await fetch(`http://localhost:${port}/healthz/live`);
    expect(liveRes.status).toBe(200);
    const liveBody = (await liveRes.json()) as { status: string };
    expect(liveBody.status).toBe('live');

    // 2. Probe /healthz/ready
    const readyRes = await fetch(`http://localhost:${port}/healthz/ready`);
    expect(readyRes.status).toBe(200);
    const readyBody = (await readyRes.json()) as { status: string };
    expect(readyBody.status).toBe('ready');

    // 3. Regular application route
    const appRes = await fetch(`http://localhost:${port}/hello`);
    expect(appRes.status).toBe(200);
    const appBody = (await appRes.json()) as { message: string };
    expect(appBody.message).toBe('world');

    // 4. Initiate graceful drain while holding an active slow request
    const inFlightReq = fetch(`http://localhost:${port}/slow`);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Initiate stop
    const stopPromise = serverHandle.stop();
    expect(serverHandle.getState()).toBe('DRAINING');

    // Probe readiness while draining: must return 503
    const drainingReadyRes = await fetch(`http://localhost:${port}/healthz/ready`);
    expect(drainingReadyRes.status).toBe(503);

    // Release slow request and complete shutdown
    releaseSlowRequest();
    await inFlightReq;
    await stopPromise;
    expect(serverHandle.getState()).toBe('TERMINATED');
  });

  it('enforces stream-bounded body limit and returns HTTP 413 Problem Details on oversized payload', async () => {
    const app = new Hono();
    app.post('/upload', async (c) => {
      const data = await c.req.text();
      return c.json({ received: data.length });
    });

    // Set maxBodyBytes to 200 bytes for test
    const config = createDefaultConfig({
      limits: { maxBodyBytes: 200 },
    });
    const port = 34568;
    const serverHandle = createSelfHostServer(app, config, { port });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // 1. Send acceptable payload (100 bytes)
    const validPayload = 'x'.repeat(100);
    const validRes = await fetch(`http://localhost:${port}/upload`, {
      method: 'POST',
      body: validPayload,
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(validRes.status).toBe(200);

    // 2. Send oversized payload (500 bytes > 200 bytes limit)
    const oversizedPayload = 'y'.repeat(500);
    const errorRes = await fetch(`http://localhost:${port}/upload`, {
      method: 'POST',
      body: oversizedPayload,
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(errorRes.status).toBe(413);
    expect(errorRes.headers.get('content-type')).toBe('application/problem+json');
    const problem = (await errorRes.json()) as { code: string; detail: string };
    expect(problem.code).toBe('PAYLOAD_TOO_LARGE');
    expect(problem.detail).toContain('exceeded maximum limit of 200 bytes');

    await serverHandle.stop();
  });

  it('injects SelfHostPlatform and allows extracting typed context via getSelfHostContext', async () => {
    let capturedIp: string | undefined;
    let capturedState: string | undefined;

    const app = new Hono();
    app.get('/inspect', (c) => {
      const selfHost = getSelfHostContext({ platform: c.env } as unknown as ActionExecutionContext);
      capturedIp = selfHost.remoteAddress;
      capturedState = selfHost.serverState();
      return c.json({ ip: capturedIp, state: capturedState });
    });

    const config = createDefaultConfig();
    const port = 34569;
    const serverHandle = createSelfHostServer(app, config, { port });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const res = await fetch(`http://localhost:${port}/inspect`);
    expect(res.status).toBe(200);
    expect(capturedIp).toBeDefined();
    expect(capturedIp).toMatch(/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/);
    expect(capturedState).toBe('HEALTHY');

    await serverHandle.stop();
  });

  it('preserves multiple Set-Cookie response headers without comma corruption', async () => {
    const app = new Hono();
    app.get('/auth/set', (c) => {
      c.header('Set-Cookie', 'sessionId=session-abc; Path=/; Secure; HttpOnly');
      c.header('Set-Cookie', 'theme=dark; Path=/', { append: true });
      return c.json({ ok: true });
    });

    const config = createDefaultConfig();
    const port = 34570;
    const serverHandle = createSelfHostServer(app, config, { port });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const res = await fetch(`http://localhost:${port}/auth/set`);
    expect(res.status).toBe(200);

    // In modern Node.js fetch, getSetCookie retrieves all individual cookies
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain('sessionId=session-abc');
    expect(cookies[1]).toContain('theme=dark');

    await serverHandle.stop();
  });

  it('evaluates dynamic isReady hook and respects custom probe paths', async () => {
    let databaseHealthy = true;

    const app = new Hono();
    const config = createDefaultConfig();
    const port = 34571;
    const serverHandle = createSelfHostServer(app, config, {
      port,
      livenessPath: '/livez',
      readinessPath: '/readyz',
      isReady: () => databaseHealthy,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Custom liveness probe
    const liveRes = await fetch(`http://localhost:${port}/livez`);
    expect(liveRes.status).toBe(200);

    // Initial readiness when db is healthy
    const readyRes = await fetch(`http://localhost:${port}/readyz`);
    expect(readyRes.status).toBe(200);
    const readyBody = (await readyRes.json()) as { status: string };
    expect(readyBody.status).toBe('ready');

    // Simulate database outage: readiness must flip to 503
    databaseHealthy = false;
    const unreadyRes = await fetch(`http://localhost:${port}/readyz`);
    expect(unreadyRes.status).toBe(503);
    const unreadyBody = (await unreadyRes.json()) as { status: string };
    expect(unreadyBody.status).toBe('unhealthy');

    await serverHandle.stop();
  });

  it('throws DomainError when getSelfHostContext is called outside selfhost runtime', () => {
    const emptyCtx = {
      platform: null,
    } as unknown as ActionExecutionContext;

    expect(() => getSelfHostContext(emptyCtx)).toThrowError(DomainError);
    try {
      getSelfHostContext(emptyCtx);
    } catch (err: unknown) {
      const domainErr = err as DomainError;
      expect(domainErr.code).toBe('INTERNAL_SERVER_ERROR');
      expect(domainErr.detail).toContain('Self-host context is missing');
    }
  });

  it('instantiates lightweight in-memory testing double via createMockSelfHostContext', () => {
    const mock = createMockSelfHostContext({
      remoteAddress: '198.51.100.42',
      remotePort: 8080,
    });

    expect(mock.remoteAddress).toBe('198.51.100.42');
    expect(mock.remotePort).toBe(8080);
    expect(mock.serverState()).toBe('HEALTHY');
  });
});
