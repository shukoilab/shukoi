/**
 * @purpose Token Bucket rate limiting algorithm.
 * @rationale Accommodates traffic bursts while strictly bounding average consumption rate; ideal for LLM token quotas.
 * @preconditions capacity and refillRate must be positive numbers.
 * @invariants O(1) time complexity; non-negative tokens; bounded memory via BoundedLruCache.
 */

import { DomainError } from '@shukoi/core';
import { BoundedLruCache } from './lru.js';
import type { RateLimitAlgorithm, RateLimitResult } from './types.js';

interface BucketState {
  tokens: number;
  lastRefill: number;
}

/**
 * @purpose Configuration options for tokenBucket algorithm.
 * @rationale Defines bucket capacity, replenishment rate, and replenishment interval.
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
  readonly maxMemoryEntries?: number | undefined;
}

/**
 * @purpose Token bucket rate limiting strategy implementation.
 * @rationale Replenishes tokens continuously based on elapsed time; permits controlled bursts up to capacity.
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
  private readonly memoryCache: BoundedLruCache<string, BucketState>;

  public constructor(options: TokenBucketOptions) {
    this.capacity = options.capacity;
    this.refillRate = options.refillRate;
    this.intervalMs = options.intervalMs ?? 1000;
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
 * @param options TokenBucketOptions configuration.
 * @returns Fully instantiated TokenBucketAlgorithm.
 * @throws Never throws during creation.
 * @invariants Pure factory function; Big-O O(1).
 */
export function tokenBucket(options: TokenBucketOptions): TokenBucketAlgorithm {
  return new TokenBucketAlgorithm(options);
}
