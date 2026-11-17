/**
 * @purpose Sliding Window Counter rate limiting algorithm.
 * @rationale Eliminates boundary burst spikes by measuring request volume across a continuous moving time window.
 * @preconditions limit and windowMs must be positive numbers.
 * @invariants O(1) in-memory lookups; atomic single-tick evaluation in Redis mode.
 */

import { DomainError } from '@shukoi/core';
import { BoundedLruCache } from './lru.js';
import type { RateLimitAlgorithm, RateLimitRedisClient, RateLimitResult } from './types.js';

/**
 * @purpose Atomic Redis Lua script for distributed sliding window rate limiting.
 * @rationale Evaluates timestamped request history in a Redis Sorted Set with bounded single-tick cleanup.
 * @preconditions KEYS[1]: rate limit key. ARGV[1]: now (ms). ARGV[2]: windowMs. ARGV[3]: limit. ARGV[4]: cost.
 * @param KEYS Redis keys array containing the rate limit key.
 * @returns Array tuple: [success (1 or 0), remaining quota, resetSeconds].
 * @throws Never throws unhandled; evaluated atomically by Redis server.
 * @invariants Single atomic roundtrip; $O(\log N)$ Sorted Set insertion and range deletion.
 */
export const SLIDING_WINDOW_LUA = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local clearBefore = now - window

redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, clearBefore)
local current = redis.call('ZCARD', KEYS[1])

if (current + cost) <= limit then
  if cost == 1 then
    redis.call('ZADD', KEYS[1], now, now .. ':' .. math.random(100000, 999999))
  else
    local entries = {}
    for i = 1, cost do
      entries[#entries + 1] = now
      entries[#entries + 1] = now .. ':' .. i .. ':' .. math.random(100000, 999999)
    end
    redis.call('ZADD', KEYS[1], unpack(entries))
  end
  redis.call('PEXPIRE', KEYS[1], window)
  return { 1, limit - current - cost, math.ceil(window / 1000) }
else
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local resetAfterSec = 1
  if oldest and oldest[2] then
    local oldestTime = tonumber(oldest[2])
    resetAfterSec = math.max(1, math.ceil((oldestTime + window - now) / 1000))
  else
    resetAfterSec = math.ceil(window / 1000)
  end
  return { 0, 0, resetAfterSec }
end
`;

/**
 * @purpose Configuration options for slidingWindow algorithm.
 * @rationale Defines allowed request limit, window size, optional Redis client, and cache capacity.
 * @preconditions limit and windowMs must be positive numbers.
 * @param None
 * @returns Configuration interface.
 * @throws Never throws.
 * @invariants limit > 0; windowMs > 0.
 */
export interface SlidingWindowOptions {
  readonly limit: number;
  readonly windowMs: number;
  readonly client?: RateLimitRedisClient | undefined;
  readonly maxMemoryEntries?: number | undefined;
}

/**
 * @purpose Sliding window rate limiting strategy implementation.
 * @rationale Tracks timestamps in moving window via in-memory BoundedLruCache or Redis Sorted Set.
 * @preconditions options must specify valid limit and windowMs.
 * @param options SlidingWindowOptions configuration.
 * @returns Instantiated SlidingWindowAlgorithm.
 * @throws Never throws during construction.
 * @invariants Bounded memory size; atomic state evaluation.
 */
export class SlidingWindowAlgorithm implements RateLimitAlgorithm {
  private readonly limitValue: number;
  private readonly windowMs: number;
  private readonly client?: RateLimitRedisClient | undefined;
  private readonly memoryCache: BoundedLruCache<string, number[]>;

  public constructor(options: SlidingWindowOptions) {
    this.limitValue = options.limit;
    this.windowMs = options.windowMs;
    this.client = options.client;
    this.memoryCache = new BoundedLruCache<string, number[]>(options.maxMemoryEntries ?? 10000);
  }

  /**
   * @purpose Evaluates rate limit for a key using sliding window counter.
   * @rationale Enforces moving window evaluation without boundary burst vulnerability.
   * @preconditions key must be a non-empty string; cost must be a positive integer.
   * @param key Unique rate limit key (e.g. IP or user ID).
   * @param cost Number of tokens consumed by invocation (default: 1).
   * @returns Structured RateLimitResult with remaining tokens and reset timing.
   * @throws DomainError('VALIDATION_ERROR', ...) if cost is non-integer or <= 0; Error on Redis failure.
   * @invariants Big-O O(log N) for Redis ZSET, O(1) amortized for in-memory.
   */
  public async limit(key: string, cost = 1): Promise<RateLimitResult> {
    if (typeof cost !== 'number' || !Number.isInteger(cost) || cost <= 0) {
      throw new DomainError('VALIDATION_ERROR', 'Rate limit cost must be a positive integer', 422);
    }
    const now = Date.now();

    // 1. Redis Mode
    if (this.client) {
      const res = (await this.client.eval(
        SLIDING_WINDOW_LUA,
        [key],
        [now, this.windowMs, this.limitValue, cost],
      )) as [number, number, number];

      const success = res[0] === 1;
      const remaining = res[1];
      const retryAfter = res[2];

      return {
        success,
        limit: this.limitValue,
        remaining: Math.max(0, remaining),
        resetMs: retryAfter * 1000,
        retryAfter: success ? 0 : retryAfter,
      };
    }

    // 2. In-Memory Mode
    const rawTimestamps = this.memoryCache.get(key) ?? [];
    const threshold = now - this.windowMs;
    const validTimestamps = rawTimestamps.filter((ts) => ts > threshold);

    if (validTimestamps.length + cost <= this.limitValue) {
      for (let i = 0; i < cost; i++) {
        validTimestamps.push(now);
      }
      this.memoryCache.set(key, validTimestamps);

      return {
        success: true,
        limit: this.limitValue,
        remaining: this.limitValue - validTimestamps.length,
        resetMs: this.windowMs,
        retryAfter: 0,
      };
    }

    // Limit exceeded
    const oldestTimestamp = validTimestamps[0] ?? now;
    const remainingTimeMs = Math.max(0, oldestTimestamp + this.windowMs - now);
    const retryAfter = Math.max(1, Math.ceil(remainingTimeMs / 1000));

    return {
      success: false,
      limit: this.limitValue,
      remaining: 0,
      resetMs: remainingTimeMs,
      retryAfter,
    };
  }
}

/**
 * @purpose Declarative factory for creating a SlidingWindowAlgorithm instance.
 * @rationale Convenience entrypoint constructing SlidingWindowAlgorithm with valid parameters.
 * @preconditions options must specify positive limit and windowMs.
 * @param options SlidingWindowOptions configuration.
 * @returns Fully instantiated SlidingWindowAlgorithm.
 * @throws Never throws during creation.
 * @invariants Pure factory function; Big-O O(1).
 */
export function slidingWindow(options: SlidingWindowOptions): SlidingWindowAlgorithm {
  return new SlidingWindowAlgorithm(options);
}
