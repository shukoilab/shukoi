/**
 * @purpose Unit tests for @shukoi/selfhost adapter, health probes, and graceful drain state machine.
 * @rationale Validates /healthz/live and /healthz/ready probes and connection draining lifecycle.
 * @preconditions Vitest test runner.
 * @invariants Assertions must pass with exit code 0.
 */

import { createDefaultConfig } from '@shukoi/core';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createSelfHostServer } from '../src/index.js';

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
});
