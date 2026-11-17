/**
 * @purpose Core RateLimiter coordinator and IETF header generator for @shukoi/ratelimit.
 * @rationale Integrates rate limiting algorithms with RFC 9457 Problem Details and IETF RateLimit headers.
 * @preconditions RateLimiterConfig must provide a valid algorithm.
 * @invariants Pure coordination layer; delegates storage and math to algorithm instances.
 */

import { DomainError } from '@shukoi/core';
import type { RateLimitAlgorithm, RateLimiterConfig, RateLimitResult } from './types.js';

/**
 * @purpose RateLimiter instance managing keys and header generation.
 * @rationale Coordinates key prefixing, evaluation, and RFC-compliant error generation.
 * @preconditions config must provide a valid RateLimitAlgorithm implementation.
 * @param config RateLimiterConfig options.
 * @returns Instantiated RateLimiter.
 * @throws Never throws during construction.
 * @invariants Big-O O(1) framework overhead.
 */
export class RateLimiter {
  private readonly algorithm: RateLimitAlgorithm;
  private readonly keyPrefix: string;

  public constructor(config: RateLimiterConfig) {
    this.algorithm = config.algorithm;
    this.keyPrefix = config.keyPrefix ?? 'shukoi:rl:';
  }

  /**
   * @purpose Formats structured RateLimitResult into standard IETF RFC headers.
   * @rationale Emits draft-ietf-httpapi-ratelimit-headers with Limit, Remaining, Reset, and conditional Retry-After.
   * @preconditions result must be a valid RateLimitResult.
   * @param result Evaluated rate limit decision.
   * @returns Record of IETF RateLimit and Retry-After headers.
   * @throws Never throws.
   * @invariants Compliant with draft-ietf-httpapi-ratelimit-headers; Big-O O(1).
   */
  public getHeaders(result: RateLimitResult): Record<string, string> {
    const resetSec = Math.max(1, Math.ceil(result.resetMs / 1000));
    const headers: Record<string, string> = {
      'RateLimit-Limit': String(result.limit),
      'RateLimit-Remaining': String(result.remaining),
      'RateLimit-Reset': String(resetSec),
    };

    if (!result.success) {
      headers['Retry-After'] = String(result.retryAfter);
    }

    return headers;
  }

  /**
   * @purpose Evaluates rate limit for an identifier.
   * @rationale Prefixes identifier and delegates rate limit math to underlying strategy.
   * @preconditions identifier must be a non-empty string; cost must be a positive integer.
   * @param identifier Unique request identifier (IP, user ID, or API key).
   * @param cost Token consumption cost (default: 1).
   * @returns Promise resolving to RateLimitResult.
   * @throws DomainError('VALIDATION_ERROR', ...) if cost is non-integer or <= 0.
   * @invariants Big-O O(1) framework overhead.
   */
  public async limit(identifier: string, cost = 1): Promise<RateLimitResult> {
    if (typeof cost !== 'number' || !Number.isInteger(cost) || cost <= 0) {
      throw new DomainError('VALIDATION_ERROR', 'Rate limit cost must be a positive integer', 422);
    }
    const fullKey = `${this.keyPrefix}${identifier}`;
    return await this.algorithm.limit(fullKey, cost);
  }

  /**
   * @purpose Asserts that request is within rate limits; throws DomainError 429 if exceeded.
   * @rationale Provides fail-fast interceptor for gateway handlers and middlewares.
   * @preconditions identifier must be a non-empty string; cost must be a positive integer.
   * @param identifier Unique request identifier.
   * @param cost Token consumption cost (default: 1).
   * @returns RateLimitResult on success.
   * @throws DomainError('RATE_LIMIT_EXCEEDED', ..., 429) on rate limit breach; DomainError('VALIDATION_ERROR', ...) on invalid cost.
   * @invariants Big-O O(1) framework overhead.
   */
  public async assert(identifier: string, cost = 1): Promise<RateLimitResult> {
    const result = await this.limit(identifier, cost);
    if (!result.success) {
      throw new DomainError(
        'RATE_LIMIT_EXCEEDED',
        `Rate limit exceeded. Try again in ${result.retryAfter} second(s).`,
        429,
        [
          { path: 'limit', message: String(result.limit) },
          { path: 'retryAfter', message: String(result.retryAfter) },
        ],
      );
    }
    return result;
  }
}

/**
 * @purpose Declarative factory for creating a RateLimiter instance.
 * @rationale Convenience entrypoint constructing RateLimiter with configuration options.
 * @preconditions config must specify valid RateLimitAlgorithm.
 * @param config RateLimiterConfig options.
 * @returns Fully instantiated RateLimiter.
 * @throws Never throws during creation.
 * @invariants Pure factory function; Big-O O(1).
 */
export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  return new RateLimiter(config);
}
