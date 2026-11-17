/**
 * @purpose Core type definitions and contracts for @shukoi/store-redis.
 * @rationale Defines transport-agnostic Redis client interfaces and store configuration parameters.
 * @preconditions Valid TypeScript environment.
 * @param None
 * @returns Type and interface exports.
 * @throws Never throws.
 * @invariants Pure type definitions; zero runtime side effects.
 */

/**
 * @purpose Minimal Redis client contract required by @shukoi/store-redis.
 * @rationale Allows wrapping any underlying driver (ioredis, node-redis, @upstash/redis, or custom HTTP fetch clients).
 * @preconditions Target Redis instance or gateway must support basic key-value commands and EVAL.
 * @param None
 * @returns Interface specification.
 * @throws Protocol or network errors during command evaluation.
 * @invariants Asynchronous promise-based API; Big-O O(1) command dispatch.
 */
export interface RedisClient {
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, duration?: number): Promise<unknown>;
  del(key: string): Promise<number>;
  quit?(): Promise<void>;
}

/**
 * @purpose Configuration options for creating a RedisIdempotencyStore.
 * @rationale Controls key namespacing, default lock TTL, and final response retention duration.
 * @preconditions client property must be a valid RedisClient implementation.
 * @param None
 * @returns Configuration interface.
 * @throws Never throws.
 * @invariants Readonly configuration object; non-negative TTLs.
 */
export interface RedisStoreOptions {
  readonly client: RedisClient;
  readonly keyPrefix?: string | undefined;
  readonly defaultLockTtlMs?: number | undefined;
  readonly defaultRetentionTtlMs?: number | undefined;
}
