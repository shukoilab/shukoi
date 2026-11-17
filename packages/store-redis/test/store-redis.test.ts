/**
 * @purpose Unit test suite for @shukoi/store-redis distributed idempotency engine.
 * @rationale Validates atomic Lua lock transitions, conflict detection, response caching, and release behavior.
 * @preconditions Vitest test runner.
 * @invariants Assertions must pass with exit code 0.
 */

import { DomainError } from '@shukoi/core';
import { describe, expect, it } from 'vitest';
import { createRedisIdempotencyStore } from '../src/store.js';
import { MockRedisClient } from '../src/testing.js';
import { UpstashRedisClient } from '../src/upstash.js';

describe('@shukoi/store-redis Engine', () => {
  it('successfully acquires lock on new key and completes execution', async () => {
    const mockClient = new MockRedisClient();
    const store = createRedisIdempotencyStore({ client: mockClient });

    // 1. Acquire
    const acquireResult = await store.tryAcquire('createPayment', 'pay-123', 5000);
    expect(acquireResult.acquired).toBe(true);
    expect(acquireResult.record?.status).toBe('IN_PROGRESS');

    // 2. Complete
    const payload = { transactionId: 'txn-999', status: 'SUCCESS' };
    await store.complete('createPayment', 'pay-123', payload, 60000);

    // 3. Subsequent call should receive cached completed record
    const secondCall = await store.tryAcquire('createPayment', 'pay-123', 5000);
    expect(secondCall.acquired).toBe(false);
    expect(secondCall.record?.status).toBe('COMPLETED');
    expect(secondCall.record?.responsePayload).toEqual(payload);
  });

  it('throws DomainError 409 CONFLICT on concurrent lock attempt', async () => {
    const mockClient = new MockRedisClient();
    const store = createRedisIdempotencyStore({ client: mockClient });

    await store.tryAcquire('transferFunds', 'transfer-1', 10000);

    // Second worker attempting identical key should be rejected with 409 CONFLICT
    await expect(store.tryAcquire('transferFunds', 'transfer-1', 10000)).rejects.toThrow(
      DomainError,
    );
    try {
      await store.tryAcquire('transferFunds', 'transfer-1', 10000);
    } catch (err) {
      expect((err as DomainError).code).toBe('CONFLICT');
      expect((err as DomainError).statusCode).toBe(409);
    }
  });

  it('releases lock cleanly on failure allowing retries', async () => {
    const mockClient = new MockRedisClient();
    const store = createRedisIdempotencyStore({ client: mockClient });

    await store.tryAcquire('sendEmail', 'email-1', 10000);

    // Release lock
    await store.release('sendEmail', 'email-1');

    // Retrying worker should be able to acquire lock now
    const retryResult = await store.tryAcquire('sendEmail', 'email-1', 10000);
    expect(retryResult.acquired).toBe(true);
  });

  it('inspects records via get() without mutating lock state', async () => {
    const mockClient = new MockRedisClient();
    const store = createRedisIdempotencyStore({ client: mockClient });

    await store.tryAcquire('inspectAction', 'key-1', 5000);
    await store.complete('inspectAction', 'key-1', { ok: true }, 5000);

    const record = await store.get('inspectAction', 'key-1');
    expect(record).toBeDefined();
    expect(record?.status).toBe('COMPLETED');
    expect(record?.responsePayload).toEqual({ ok: true });
  });

  it('dispatches commands correctly via UpstashRedisClient', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        expect(url.toString()).toBe('https://mock-upstash.io');
        const headers = init?.headers as Record<string, string>;
        expect(headers['Authorization']).toBe('Bearer mock-token');

        const body = JSON.parse(init?.body as string);
        if (body[0] === 'GET') {
          return new Response(JSON.stringify({ result: 'cached-val' }));
        }
        if (body[0] === 'DEL') {
          return new Response(JSON.stringify({ result: 1 }));
        }
        return new Response(JSON.stringify({ result: 'OK' }));
      }) as typeof fetch;

      const client = new UpstashRedisClient({
        url: 'https://mock-upstash.io',
        token: 'mock-token',
      });

      const getRes = await client.get('my-key');
      expect(getRes).toBe('cached-val');

      const delRes = await client.del('my-key');
      expect(delRes).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
