/**
 * @purpose Token Bucket rate limiting algorithm with in-memory LRU and distributed Redis backend.
 * @rationale Accommodates traffic bursts while strictly bounding average consumption rate; ideal for LLM token quotas.
 * @preconditions capacity and refillRate must be positive numbers.
 * @invariants O(1) time complexity; non-negative tokens; bounded memory via BoundedLruCache; atomic Redis Lua evaluation.
 */

import { DomainError } from '@shukoi/core';
import { BoundedLruCache } from './lru.js';
import type { RateLimitAlgorithm, RateLimitRedisClient, RateLimitResult } from './types.js';

interface BucketState {
  tokens: number;
  lastRefill: number;
}

/**
 * @purpose Atomic Redis Lua script for distributed token bucket evaluation.
 * @rationale Computes token replenishment and consumption in a single atomic tick using Redis Hash.
 * @preconditions KEYS[1]: bucket key. ARGV[1]: capacity. ARGV[2]: refillRate. ARGV[3]: intervalMs. ARGV[4]: now. ARGV[5]: cost.
 * @param KEYS Redis keys array with single bucket key.
 * @returns Array tuple: [success (1 or 0), remaining tokens, resetMs, retryAfter seconds].
 * @throws Never throws unhandled; Redis returns integer/array status.
 * @invariants Single atomic roundtrip; $O(1)$ time complexity; resilient TTL expiration.
 */
export const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local intervalMs = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local cost = tonumber(ARGV[5])

local data = redis.call('HMGET', key, 'tokens', 'lastRefill')
local tokens = tonumber(data[1])
local lastRefill = tonumber(data[2])

if not tokens or not lastRefill then
  tokens = capacity
  lastRefill = now
else
  local elapsed = math.max(0, now - lastRefill)
  local added = (elapsed / intervalMs) * refillRate
  tokens = math.min(capacity, tokens + added)
end

if tokens >= cost then
  local remaining = tokens - cost
  redis.call('HSET', key, 'tokens', remaining, 'lastRefill', now)
  local ttlSec = math.max(2, math.ceil(((capacity - remaining) / refillRate) * (intervalMs / 1000))) * 2
  redis.call('PEXPIRE', key, ttlSec * 1000)
  local resetMs = math.ceil(((capacity - remaining) / refillRate) * intervalMs)
  return { 1, math.floor(remaining), resetMs, 0 }
else
  local deficit = cost - tokens
  local timeNeededMs = math.ceil((deficit / refillRate) * intervalMs)
  local retryAfter = math.max(1, math.ceil(timeNeededMs / 1000))
  return { 0, math.floor(tokens), timeNeededMs, retryAfter }
end
`;

/**
 * @purpose Configuration options for tokenBucket algorithm.
 * @rationale Defines bucket capacity, replenishment rate, interval, cache capacity, and optional Redis client.
 * @preconditions capacity and refillRate must be positive numbers.
 * @param None
 * @returns Configuration interface.
 * @throws Never throws.
 * @invariants capacity > 0; refillRate > 0.
 */
export interface TokenBucketOptions {
  readonly capacity: number;
  readonly refillRate: number; // tokens added per interval
  readonly intervalMs?: number | undefined; // interval duration (default: 1000 ms)
  readonly client?: RateLimitRedisClient | undefined;
  readonly maxMemoryEntries?: number | undefined;
}

/**
 * @purpose Token bucket rate limiting strategy implementation.
 * @rationale Replenishes tokens continuously based on elapsed time; permits controlled bursts up to capacity in-memory or in Redis.
 * @preconditions options must specify positive capacity and refillRate.
 * @param options TokenBucketOptions configuration.
 * @returns Instantiated TokenBucketAlgorithm.
 * @throws Never throws during construction.
 * @invariants Tokens in bucket never exceed capacity; Big-O O(1).
 */
export class TokenBucketAlgorithm implements RateLimitAlgorithm {
  private readonly capacity: number;
  private readonly refillRate: number;
  private readonly intervalMs: number;
  private readonly client?: RateLimitRedisClient | undefined;
  private readonly memoryCache: BoundedLruCache<string, BucketState>;

  public constructor(options: TokenBucketOptions) {
    this.capacity = options.capacity;
    this.refillRate = options.refillRate;
    this.intervalMs = options.intervalMs ?? 1000;
    this.client = options.client;
    this.memoryCache = new BoundedLruCache<string, BucketState>(options.maxMemoryEntries ?? 10000);
  }

  /**
   * @purpose Evaluates token bucket availability and consumes tokens on success.
   * @rationale Replenishes tokens linearly with time and decrements cost if sufficient tokens exist.
   * @preconditions key must be a non-empty string; cost must be a positive integer.
   * @param key Unique client key.
   * @param cost Tokens to consume (default: 1).
   * @returns Structured RateLimitResult indicating success, remaining tokens, and reset timing.
   * @throws DomainError('VALIDATION_ERROR', ...) if cost is non-integer or <= 0.
   * @invariants Big-O O(1) arithmetic calculation.
   */
  public async limit(key: string, cost = 1): Promise<RateLimitResult> {
    if (typeof cost !== 'number' || !Number.isInteger(cost) || cost <= 0) {
      throw new DomainError('VALIDATION_ERROR', 'Rate limit cost must be a positive integer', 422);
    }
    const now = Date.now();

    // 1. Redis Distributed Mode
    if (this.client) {
      const res = (await this.client.eval(
        TOKEN_BUCKET_LUA,
        [key],
        [this.capacity, this.refillRate, this.intervalMs, now, cost],
      )) as [number, number, number, number];

      const [allowed, remaining, resetMs, retryAfter] = res;
      return {
        success: allowed === 1,
        limit: this.capacity,
        remaining,
        resetMs,
        retryAfter,
      };
    }

    // 2. In-Memory Mode
    const existing = this.memoryCache.get(key) ?? {
      tokens: this.capacity,
      lastRefill: now,
    };

    // Calculate replenished tokens since last check
    const elapsedMs = Math.max(0, now - existing.lastRefill);
    const addedTokens = (elapsedMs / this.intervalMs) * this.refillRate;
    const currentTokens = Math.min(this.capacity, existing.tokens + addedTokens);

    if (currentTokens >= cost) {
      const remainingTokens = currentTokens - cost;
      this.memoryCache.set(key, {
        tokens: remainingTokens,
        lastRefill: now,
      });

      return {
        success: true,
        limit: this.capacity,
        remaining: Math.floor(remainingTokens),
        resetMs: Math.ceil(((this.capacity - remainingTokens) / this.refillRate) * this.intervalMs),
        retryAfter: 0,
      };
    }

    // Capacity deficit: calculate time until sufficient tokens are available
    const deficit = cost - currentTokens;
    const timeNeededMs = Math.ceil((deficit / this.refillRate) * this.intervalMs);
    const retryAfter = Math.max(1, Math.ceil(timeNeededMs / 1000));

    return {
      success: false,
      limit: this.capacity,
      remaining: Math.floor(currentTokens),
      resetMs: timeNeededMs,
      retryAfter,
    };
  }
}

/**
 * @purpose Declarative factory for creating a TokenBucketAlgorithm instance.
 * @rationale Convenience entrypoint constructing TokenBucketAlgorithm with valid options.
 * @preconditions options must specify positive capacity and refillRate.
 * @param options TokenBucketOptions configuration parameters.
 * @returns Fully instantiated TokenBucketAlgorithm.
 * @throws Never throws during creation.
 * @invariants Pure factory function; Big-O O(1).
 */
export function tokenBucket(options: TokenBucketOptions): TokenBucketAlgorithm {
  return new TokenBucketAlgorithm(options);
}
