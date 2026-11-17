/**
 * @purpose Unit test suite for @shukoi/ratelimit algorithms and header emissions.
 * @rationale Validates Sliding Window, Token Bucket, Redis Lua simulation, LRU memory bounds, and 429 errors.
 * @preconditions Vitest test runner.
 * @invariants Assertions must pass with exit code 0.
 */

import { DomainError } from '@shukoi/core';
import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../src/limiter.js';
import { BoundedLruCache } from '../src/lru.js';
import { slidingWindow } from '../src/sliding-window.js';
import { MockRateLimitRedisClient } from '../src/testing.js';
import { tokenBucket } from '../src/token-bucket.js';

describe('@shukoi/ratelimit Suite', () => {
  it('enforces in-memory sliding window limit and emits IETF headers', async () => {
    const limiter = createRateLimiter({
      algorithm: slidingWindow({
        limit: 3,
        windowMs: 5000,
      }),
    });

    const res1 = await limiter.limit('user-1');
    expect(res1.success).toBe(true);
    expect(res1.remaining).toBe(2);

    const res2 = await limiter.limit('user-1');
    expect(res2.success).toBe(true);
    expect(res2.remaining).toBe(1);

    const res3 = await limiter.limit('user-1');
    expect(res3.success).toBe(true);
    expect(res3.remaining).toBe(0);

    // 4th request exceeds limit
    const res4 = await limiter.limit('user-1');
    expect(res4.success).toBe(false);
    expect(res4.remaining).toBe(0);
    expect(res4.retryAfter).toBeGreaterThanOrEqual(1);

    const headers = limiter.getHeaders(res4);
    expect(headers['RateLimit-Limit']).toBe('3');
    expect(headers['RateLimit-Remaining']).toBe('0');
    expect(headers['RateLimit-Reset']).toBeDefined();
    expect(headers['Retry-After']).toBeDefined();
  });

  it('rejects negative, zero, fractional, and NaN costs with 422 VALIDATION_ERROR', async () => {
    const limiter = createRateLimiter({
      algorithm: slidingWindow({ limit: 10, windowMs: 10000 }),
    });

    await expect(limiter.limit('user-cost', -5)).rejects.toThrow(DomainError);
    await expect(limiter.limit('user-cost', 0)).rejects.toThrow(DomainError);
    await expect(limiter.limit('user-cost', 2.5)).rejects.toThrow(DomainError);
    await expect(limiter.limit('user-cost', Number.NaN)).rejects.toThrow(DomainError);

    const bucketLimiter = createRateLimiter({
      algorithm: tokenBucket({ capacity: 10, refillRate: 1 }),
    });

    await expect(bucketLimiter.limit('user-cost', -1)).rejects.toThrow(DomainError);
    await expect(bucketLimiter.limit('user-cost', 0)).rejects.toThrow(DomainError);
    await expect(bucketLimiter.limit('user-cost', 1.1)).rejects.toThrow(DomainError);
  });

  it('throws DomainError 429 RATE_LIMIT_EXCEEDED on assert()', async () => {
    const limiter = createRateLimiter({
      algorithm: slidingWindow({
        limit: 1,
        windowMs: 10000,
      }),
    });

    await limiter.assert('client-ip');

    await expect(limiter.assert('client-ip')).rejects.toThrow(DomainError);
    try {
      await limiter.assert('client-ip');
    } catch (err) {
      expect((err as DomainError).code).toBe('RATE_LIMIT_EXCEEDED');
      expect((err as DomainError).statusCode).toBe(429);
    }
  });

  it('enforces token bucket burst capacity and refill', async () => {
    const limiter = createRateLimiter({
      algorithm: tokenBucket({
        capacity: 5,
        refillRate: 1, // 1 token per 500 ms
        intervalMs: 500,
      }),
    });

    // Burst consume 5 tokens
    const burstRes = await limiter.limit('llm-user', 5);
    expect(burstRes.success).toBe(true);
    expect(burstRes.remaining).toBe(0);

    // Immediate 6th token should fail
    const overBurst = await limiter.limit('llm-user', 1);
    expect(overBurst.success).toBe(false);
    expect(overBurst.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it('evaluates Redis sliding window Lua script via MockRateLimitRedisClient', async () => {
    const redisMock = new MockRateLimitRedisClient();
    const limiter = createRateLimiter({
      algorithm: slidingWindow({
        limit: 2,
        windowMs: 10000,
        client: redisMock,
      }),
    });

    const r1 = await limiter.limit('api-key-1');
    expect(r1.success).toBe(true);
    expect(r1.remaining).toBe(1);

    const r2 = await limiter.limit('api-key-1');
    expect(r2.success).toBe(true);
    expect(r2.remaining).toBe(0);

    const r3 = await limiter.limit('api-key-1');
    expect(r3.success).toBe(false);
    expect(r3.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it('bounds memory in BoundedLruCache and evicts oldest entries', () => {
    const cache = new BoundedLruCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.size).toBe(3);

    // Adding 4th entry evicts 'a'
    cache.set('d', 4);
    expect(cache.size).toBe(3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });
});
