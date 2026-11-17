/**
 * @purpose Core type definitions and contracts for @shukoi/ratelimit.
 * @rationale Defines rate limiting results, algorithm interfaces, and configuration structures.
 * @preconditions Valid TypeScript environment.
 * @param None
 * @returns Type and interface exports.
 * @throws Never throws.
 * @invariants Pure type definitions; immutable result structures.
 */

/**
 * @purpose Structured rate limiting decision result.
 * @rationale Contains boolean success flag and standard IETF RFC header values.
 * @preconditions None.
 * @param None
 * @returns Interface specification.
 * @throws Never throws.
 * @invariants Readonly result; retryAfter is a non-negative integer (seconds).
 */
export interface RateLimitResult {
  readonly success: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetMs: number;
  readonly retryAfter: number; // in whole seconds
}

/**
 * @purpose Pluggable rate limit algorithm strategy contract.
 * @rationale Encapsulates Sliding Window, Token Bucket, or custom rate limit math.
 * @preconditions key must be a non-empty string; cost must be positive integer if provided.
 * @param None
 * @returns Interface specification.
 * @throws DomainError('VALIDATION_ERROR', ...) on invalid cost parameters.
 * @invariants Thread-safe; async promise-based; Big-O O(1) decision time.
 */
export interface RateLimitAlgorithm {
  limit(key: string, cost?: number): Promise<RateLimitResult>;
}

/**
 * @purpose Options for configuring a rate limiter instance.
 * @rationale Parameterizes key prefix, fallback algorithm, and error reporting.
 * @preconditions algorithm property must be an initialized RateLimitAlgorithm.
 * @param None
 * @returns Configuration interface.
 * @throws Never throws.
 * @invariants Readonly configuration object.
 */
export interface RateLimiterConfig {
  readonly algorithm: RateLimitAlgorithm;
  readonly keyPrefix?: string | undefined;
}

/**
 * @purpose Redis client adapter interface compatible with @shukoi/ratelimit.
 * @rationale Allows passing Redis clients without depending directly on a specific driver package.
 * @preconditions Redis instance must support basic commands and EVAL.
 * @param None
 * @returns Interface specification.
 * @throws Command evaluation or network errors.
 * @invariants Matches @shukoi/store-redis RedisClient contract.
 */
export interface RateLimitRedisClient {
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, duration?: number): Promise<unknown>;
  del(key: string): Promise<number>;
}
