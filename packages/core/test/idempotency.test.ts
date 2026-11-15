/**
 * @purpose Unit tests for InMemoryIdempotencyStore atomic state transitions and TTL eviction.
 * @rationale Validates exactly-once mutation semantics and memory bounds under concurrency.
 * @preconditions Vitest test runner.
 * @invariants Assertions must pass with exit code 0.
 */

import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/errors.js';
import { InMemoryIdempotencyStore } from '../src/idempotency.js';

describe('InMemoryIdempotencyStore', () => {
  it('acquires lock on first call and rejects duplicate concurrent requests with 409 Conflict', async () => {
    const store = new InMemoryIdempotencyStore(100);

    const first = await store.tryAcquire('createOrder', 'key-101', 5000);
    expect(first.acquired).toBe(true);
    expect(first.record?.status).toBe('IN_PROGRESS');

    // Concurrent call with same key must throw CONFLICT
    await expect(store.tryAcquire('createOrder', 'key-101', 5000)).rejects.toThrow(DomainError);
    try {
      await store.tryAcquire('createOrder', 'key-101', 5000);
    } catch (err) {
      expect((err as DomainError).code).toBe('CONFLICT');
      expect((err as DomainError).statusCode).toBe(409);
    }
  });

  it('completes lock and returns cached response payload on subsequent attempts', async () => {
    const store = new InMemoryIdempotencyStore(100);

    await store.tryAcquire('createOrder', 'key-202', 5000);
    await store.complete('createOrder', 'key-202', { orderId: 'ord-999', status: 'created' }, 5000);

    const subsequent = await store.tryAcquire('createOrder', 'key-202', 5000);
    expect(subsequent.acquired).toBe(false);
    expect(subsequent.record?.status).toBe('COMPLETED');
    expect(subsequent.record?.responsePayload).toEqual({ orderId: 'ord-999', status: 'created' });
  });

  it('releases lock on unhandled failure allowing retries', async () => {
    const store = new InMemoryIdempotencyStore(100);

    await store.tryAcquire('chargeCard', 'key-303', 5000);
    await store.release('chargeCard', 'key-303');

    // Retry should now succeed
    const retry = await store.tryAcquire('chargeCard', 'key-303', 5000);
    expect(retry.acquired).toBe(true);
  });

  it('enforces maximum capacity bounds by evicting oldest entries', async () => {
    const store = new InMemoryIdempotencyStore(3);

    await store.tryAcquire('action', 'k1', 5000);
    await store.tryAcquire('action', 'k2', 5000);
    await store.tryAcquire('action', 'k3', 5000);
    expect(store.size).toBe(3);

    // Adding 4th entry should trigger eviction of oldest (k1)
    await store.tryAcquire('action', 'k4', 5000);
    expect(store.size).toBe(3);

    // k1 should be gone, acquiring k1 now succeeds as new
    const reacquireK1 = await store.tryAcquire('action', 'k1', 5000);
    expect(reacquireK1.acquired).toBe(true);
  });
});
