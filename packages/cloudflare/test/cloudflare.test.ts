/**
 * @purpose Unit tests for @shukoi/cloudflare adapter and in-memory testing mocks.
 * @rationale Validates Cloudflare Worker module export, env injection, getCloudflareContext helper, and in-memory KV/D1 doubles.
 * @preconditions Vitest test runner.
 * @invariants Assertions must pass with exit code 0.
 */

import { type ActionExecutionContext, DomainError } from '@shukoi/core';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { getCloudflareContext, toCloudflareWorker } from '../src/index.js';
import { createMockD1, createMockKv } from '../src/testing.js';

describe('Cloudflare Workers Adapter', () => {
  it('wraps Hono app and passes env and executionCtx correctly', async () => {
    const app = new Hono();
    let waitUntilCalled = false;

    app.get('/test', (c) => {
      const env = c.env as { KV: string };
      c.executionCtx.waitUntil(
        Promise.resolve().then(() => {
          waitUntilCalled = true;
        }),
      );
      return c.json({ ok: true, kv: env.KV });
    });

    const worker = toCloudflareWorker(app);

    const mockCtx = {
      waitUntil(p: Promise<unknown>) {
        void p;
      },
      passThroughOnException() {},
    };

    const req = new Request('http://localhost/test');
    const res = await worker.fetch(req, { KV: 'mock-d1-binding' }, mockCtx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; kv: string };
    expect(body.ok).toBe(true);
    expect(body.kv).toBe('mock-d1-binding');
    expect(waitUntilCalled).toBe(true);
  });

  it('extracts strongly typed Cloudflare context and executes waitUntil safely', async () => {
    let backgroundPromiseSettled = false;

    const mockExecutionCtx = {
      waitUntil(promise: Promise<unknown>) {
        void promise.then(() => {
          backgroundPromiseSettled = true;
        });
      },
      passThroughOnException() {},
    };

    const mockCtx = {
      platform: {
        env: { DB: 'mock-d1-instance', KV: 'mock-kv-instance' },
        executionCtx: mockExecutionCtx,
        waitUntil: (p: Promise<unknown>) => mockExecutionCtx.waitUntil(p),
      },
    } as unknown as ActionExecutionContext;

    const cf = getCloudflareContext<{ DB: string; KV: string }>(mockCtx);
    expect(cf.env.DB).toBe('mock-d1-instance');
    expect(cf.env.KV).toBe('mock-kv-instance');

    cf.waitUntil(Promise.resolve());
    await new Promise((r) => setTimeout(r, 10));
    expect(backgroundPromiseSettled).toBe(true);
  });

  it('throws DomainError when getCloudflareContext is called outside Cloudflare isolate', () => {
    const emptyCtx = {
      platform: null,
    } as unknown as ActionExecutionContext;

    expect(() => getCloudflareContext(emptyCtx)).toThrowError(DomainError);
    try {
      getCloudflareContext(emptyCtx);
    } catch (err: unknown) {
      const domainErr = err as DomainError;
      expect(domainErr.code).toBe('INTERNAL_SERVER_ERROR');
      expect(domainErr.detail).toContain('Cloudflare context is missing');
    }
  });

  it('executes in-memory createMockKv operations cleanly', async () => {
    const kv = createMockKv({ greeting: 'hello' });

    // 1. Initial read
    expect(await kv.get('greeting')).toBe('hello');
    expect(await kv.get('missing')).toBeNull();

    // 2. Put JSON and read as JSON
    await kv.put('config', JSON.stringify({ timeout: 5000 }));
    const parsed = await kv.get<{ timeout: number }>('config', 'json');
    expect(parsed?.timeout).toBe(5000);

    // 3. Put with metadata and read getWithMetadata
    await kv.put('session', 'active-token', { metadata: { userId: 'usr-123' } });
    const metaRes = await kv.getWithMetadata<string, { userId: string }>('session');
    expect(metaRes.value).toBe('active-token');
    expect(metaRes.metadata?.userId).toBe('usr-123');

    // 4. List keys
    const listRes = await kv.list({ prefix: 'g' });
    expect(listRes.keys).toHaveLength(1);
    expect(listRes.keys[0]?.name).toBe('greeting');

    // 5. Delete key
    await kv.delete('greeting');
    expect(await kv.get('greeting')).toBeNull();
  });

  it('executes in-memory createMockD1 queries and statement chaining cleanly', async () => {
    const d1 = createMockD1({
      defaultRows: [
        { id: 1, name: 'Alice', role: 'admin' },
        { id: 2, name: 'Bob', role: 'user' },
      ],
    });

    // 1. first()
    const firstRow = await d1.prepare('SELECT * FROM users').first<{ id: number; name: string }>();
    expect(firstRow?.id).toBe(1);
    expect(firstRow?.name).toBe('Alice');

    // Specific column first()
    const role = await d1.prepare('SELECT role FROM users').first<string>('role');
    expect(role).toBe('admin');

    // 2. all()
    const allRes = await d1.prepare('SELECT * FROM users').bind('active').all<{ id: number }>();
    expect(allRes.success).toBe(true);
    expect(allRes.results).toHaveLength(2);

    // 3. run()
    const runRes = await d1
      .prepare('UPDATE users SET role = ? WHERE id = ?')
      .bind('superadmin', 1)
      .run();
    expect(runRes.success).toBe(true);
    expect(runRes.meta.changes).toBe(1);

    // 4. batch()
    const batchRes = await d1.batch([
      d1.prepare('SELECT * FROM users WHERE id = 1'),
      d1.prepare('SELECT * FROM users WHERE id = 2'),
    ]);
    expect(batchRes).toHaveLength(2);
    expect(batchRes[0]?.success).toBe(true);

    // 5. Custom query handler
    const dynamicD1 = createMockD1({
      queryHandler: (sql, params) => {
        if (sql.includes('count')) {
          return [{ total: params[0] === 'active' ? 42 : 0 }];
        }
        return [];
      },
    });

    const countRes = await dynamicD1
      .prepare('SELECT count(*) FROM users WHERE status = ?')
      .bind('active')
      .first<{ total: number }>();
    expect(countRes?.total).toBe(42);
  });
});
