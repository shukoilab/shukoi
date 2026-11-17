/**
 * @purpose In-memory Redis simulation client for testing Redis rate limit algorithms.
 * @rationale Simulates Redis Sorted Sets (ZSET) commands in memory to test sliding window Lua scripts in CI.
 * @preconditions None.
 * @param None
 * @returns Class definition.
 * @throws Never throws.
 * @invariants Pure in-memory simulation; Big-O O(N) sort time.
 */

import type { RateLimitRedisClient } from './types.js';

interface ZSetEntry {
  score: number;
  member: string;
}

interface StoredBucket {
  tokens: number;
  lastRefill: number;
}

/**
 * @purpose Mock Redis client simulating Sorted Sets for rate limiting tests.
 * @rationale Validates Redis sliding window script execution without external Redis network dependencies.
 * @preconditions None.
 * @param None
 * @returns Instantiated MockRateLimitRedisClient.
 * @throws Never throws during construction.
 * @invariants Thread-safe single-event-loop execution.
 */
export class MockRateLimitRedisClient implements RateLimitRedisClient {
  private readonly zsets = new Map<string, ZSetEntry[]>();
  private readonly hashes = new Map<string, StoredBucket>();

  /**
   * @purpose Evaluates simulated rate limit Lua scripts in memory.
   * @rationale Mimics Redis sliding window ZSET and token bucket HSET operations.
   * @preconditions keys array must contain target key.
   * @param script Script identifier or Lua content.
   * @param keys Keys accessed by script.
   * @param args Script arguments.
   * @returns Array tuple with rate limit decision.
   * @throws Error if key is missing.
   * @invariants Big-O O(1).
   */
  public async eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> {
    const key = keys[0];
    if (!key) {
      throw new Error('MockRateLimitRedisClient: Missing key');
    }

    // 1. Token Bucket Simulation
    if (script.includes("redis.call('HSET', key, 'tokens', remaining")) {
      const capacity = Number(args[0]);
      const refillRate = Number(args[1]);
      const intervalMs = Number(args[2]);
      const now = Number(args[3]);
      const cost = Number(args[4]);

      const stored = this.hashes.get(key) ?? { tokens: capacity, lastRefill: now };
      const elapsed = Math.max(0, now - stored.lastRefill);
      const added = (elapsed / intervalMs) * refillRate;
      const currentTokens = Math.min(capacity, stored.tokens + added);

      if (currentTokens >= cost) {
        const remaining = currentTokens - cost;
        this.hashes.set(key, { tokens: remaining, lastRefill: now });
        const resetMs = Math.ceil(((capacity - remaining) / refillRate) * intervalMs);
        return [1, Math.floor(remaining), resetMs, 0];
      }

      const deficit = cost - currentTokens;
      const timeNeededMs = Math.ceil((deficit / refillRate) * intervalMs);
      const retryAfter = Math.max(1, Math.ceil(timeNeededMs / 1000));
      return [0, Math.floor(currentTokens), timeNeededMs, retryAfter];
    }

    // 2. Sliding Window Simulation
    const now = Number(args[0]);
    const window = Number(args[1]);
    const limit = Number(args[2]);
    const cost = Number(args[3]);
    const clearBefore = now - window;

    let entries = this.zsets.get(key) ?? [];
    entries = entries.filter((e) => e.score > clearBefore);
    this.zsets.set(key, entries);

    const current = entries.length;

    if (current + cost <= limit) {
      for (let i = 1; i <= cost; i++) {
        entries.push({ score: now, member: `${now}:${i}:${Math.random()}` });
      }
      this.zsets.set(key, entries);
      return [1, limit - current - cost, Math.ceil(window / 1000)];
    }

    const oldest = entries[0];
    const resetAfterSec = oldest
      ? Math.max(1, Math.ceil((oldest.score + window - now) / 1000))
      : Math.ceil(window / 1000);

    return [0, 0, resetAfterSec];
  }

  /**
   * @purpose Mock GET command.
   * @rationale Implements RedisClient contract for testing.
   * @preconditions None.
   * @param None
   * @returns Always returns null.
   * @throws Never throws.
   * @invariants Big-O O(1).
   */
  public async get(): Promise<string | null> {
    return null;
  }

  /**
   * @purpose Mock SET command.
   * @rationale Implements RedisClient contract for testing.
   * @preconditions None.
   * @param None
   * @returns Always returns 'OK'.
   * @throws Never throws.
   * @invariants Big-O O(1).
   */
  public async set(): Promise<unknown> {
    return 'OK';
  }

  /**
   * @purpose Mock DEL command deleting sorted set.
   * @rationale Implements RedisClient contract for testing.
   * @preconditions key must be a non-empty string.
   * @param key Target key to delete.
   * @returns 1 if deleted, 0 if not present.
   * @throws Never throws.
   * @invariants Big-O O(1).
   */
  public async del(key: string): Promise<number> {
    const deleted = this.zsets.delete(key);
    return deleted ? 1 : 0;
  }
}
