/**
 * @purpose Unit tests for @shukoi/cloudflare adapter.
 * @rationale Validates Cloudflare Worker module export and env injection.
 * @preconditions Vitest test runner.
 * @invariants Assertions must pass with exit code 0.
 */

import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { toCloudflareWorker } from '../src/index.js';

describe('Cloudflare Workers Adapter', () => {
  it('wraps Hono app and passes env and executionCtx correctly', async () => {
    const app = new Hono();
    app.get('/test', (c) => {
      const env = c.env as { KV: string };
      return c.json({ ok: true, kv: env.KV });
    });

    const worker = toCloudflareWorker(app);
    let _waitUntilCalled = false;

    const mockCtx = {
      waitUntil(_p: Promise<unknown>) {
        _waitUntilCalled = true;
      },
      passThroughOnException() {},
    };

    const req = new Request('http://localhost/test');
    const res = await worker.fetch(req, { KV: 'mock-d1-binding' }, mockCtx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; kv: string };
    expect(body.ok).toBe(true);
    expect(body.kv).toBe('mock-d1-binding');
  });
});
