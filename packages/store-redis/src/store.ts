/**
 * @purpose Distributed Redis-backed implementation of the Shukoi IdempotencyStore interface.
 * @rationale Guarantees exactly-once execution across multi-instance deployments using atomic Redis Lua scripts.
 * @preconditions RedisClient instance must be initialized and reachable.
 * @invariants Atomic lock acquisition; non-blocking; Big-O O(1) time complexity.
 */

import { DomainError, type IdempotencyRecord, type IdempotencyStore } from '@shukoi/core';
import { wrapRedisClient } from './adapter.js';
import { ACQUIRE_LUA, COMPLETE_LUA, EXTEND_LUA, RELEASE_LUA } from './lua.js';
import type { RedisClient, RedisStoreOptions } from './types.js';

/**
 * @purpose Distributed Redis IdempotencyStore implementation.
 * @rationale Coordinates atomic lock transitions and cached response payloads across distributed workers.
 * @preconditions options must provide an initialized RedisClient.
 * @param options RedisStoreOptions configuration.
 * @returns Instantiated RedisIdempotencyStore instance.
 * @throws Never throws during construction.
 * @invariants Thread-safe; atomic evaluation; PX TTL prevents permanent deadlocks.
 */
export class RedisIdempotencyStore implements IdempotencyStore {
  private readonly client: RedisClient;
  private readonly keyPrefix: string;
  private readonly defaultLockTtlMs: number;
  private readonly defaultRetentionTtlMs: number;
  private readonly workerToken: string;

  public constructor(options: RedisStoreOptions) {
    this.client = wrapRedisClient(options.client);
    this.keyPrefix = options.keyPrefix ?? 'shukoi:idemp:';
    this.defaultLockTtlMs = options.defaultLockTtlMs ?? 30000;
    this.defaultRetentionTtlMs = options.defaultRetentionTtlMs ?? 86400000;
    this.workerToken = crypto.randomUUID();
  }

  private compositeKey(actionName: string, key: string): string {
    return `${this.keyPrefix}${actionName}:${key}`;
  }

  /**
   * @purpose Attempts to atomically acquire an idempotency lock for an action execution.
   * @rationale Invokes atomic Lua script. If IN_PROGRESS by another worker, throws 409 Conflict. If COMPLETED, returns cached response.
   * @preconditions actionName and key must be non-empty strings.
   * @param actionName Target action name.
   * @param key Unique client idempotency key.
   * @param ttlMs Lock time-to-live in milliseconds before auto-expiration.
   * @returns Object indicating acquisition status and existing record if available.
   * @throws DomainError('CONFLICT', ...) if another concurrent worker currently holds the lock.
   * @invariants Big-O O(1) single-roundtrip script execution.
   */
  public async tryAcquire(
    actionName: string,
    key: string,
    ttlMs?: number,
  ): Promise<{ acquired: boolean; record?: IdempotencyRecord }> {
    const lockKey = this.compositeKey(actionName, key);
    const lockTtl = ttlMs ?? this.defaultLockTtlMs;
    const now = Date.now();

    const result = (await this.client.eval(
      ACQUIRE_LUA,
      [lockKey],
      [this.workerToken, lockTtl, now, actionName, key],
    )) as [string, string];

    const [status, payload] = result;

    if (status === 'CONFLICT') {
      throw new DomainError(
        'CONFLICT',
        `Action "${actionName}" with idempotency key "${key}" is currently in progress`,
        409,
      );
    }

    if (status === 'COMPLETED') {
      const record = JSON.parse(payload) as IdempotencyRecord;
      return { acquired: false, record };
    }

    if (status === 'ACQUIRED') {
      const record = JSON.parse(payload) as IdempotencyRecord;
      return { acquired: true, record };
    }

    throw new DomainError(
      'INTERNAL_SERVER_ERROR',
      `Unexpected idempotency lock status from Redis: "${status}"`,
      500,
    );
  }

  /**
   * @purpose Marks an acquired idempotency lock as COMPLETED and persists the sanitized output payload.
   * @rationale Replaces the IN_PROGRESS lock record with COMPLETED state and sets the long-term retention TTL.
   * @preconditions actionName and key must be non-empty strings.
   * @param actionName Target action name.
   * @param key Unique client idempotency key.
   * @param payload Final handler response payload to cache.
   * @param ttlMs Retention duration in milliseconds for the cached response.
   * @returns Promise resolving when cache state is updated in Redis.
   * @throws Never throws unhandled; errors bubble with context.
   * @invariants Big-O O(1).
   */
  public async complete(
    actionName: string,
    key: string,
    payload: unknown,
    ttlMs?: number,
  ): Promise<void> {
    const lockKey = this.compositeKey(actionName, key);
    const retentionTtl = ttlMs ?? this.defaultRetentionTtlMs;
    const now = Date.now();

    const record: IdempotencyRecord = {
      actionName,
      key,
      status: 'COMPLETED',
      responsePayload: payload,
      expiresAt: now + retentionTtl,
    };

    await this.client.eval(
      COMPLETE_LUA,
      [lockKey],
      [this.workerToken, JSON.stringify(record), retentionTtl],
    );
  }

  /**
   * @purpose Extends/renews an active in-progress idempotency lock duration (heartbeat).
   * @rationale Prevents lock expiration during long-running async computations if the lock is still owned.
   * @preconditions actionName and key must be non-empty strings.
   * @param actionName Target action name.
   * @param key Unique client idempotency key.
   * @param additionalTtlMs Milliseconds to extend the lock by (defaults to defaultLockTtlMs).
   * @returns True if lock TTL was successfully extended, false if expired or owned by another worker.
   * @throws Never throws unhandled.
   * @invariants Big-O O(1) single atomic roundtrip.
   */
  public async extendLock(
    actionName: string,
    key: string,
    additionalTtlMs?: number,
  ): Promise<boolean> {
    const lockKey = this.compositeKey(actionName, key);
    const ttl = additionalTtlMs ?? this.defaultLockTtlMs;
    const now = Date.now();
    const result = (await this.client.eval(
      EXTEND_LUA,
      [lockKey],
      [this.workerToken, ttl, now],
    )) as number;
    return result === 1;
  }

  /**
   * @purpose Releases an acquired in-progress idempotency lock upon unhandled execution failure.
   * @rationale Prevents subsequent client retries from being blocked by a failed execution.
   * @preconditions actionName and key must be non-empty strings.
   * @param actionName Target action name.
   * @param key Unique client idempotency key.
   * @returns Promise resolving when lock deletion completes.
   * @throws Never throws unhandled.
   * @invariants Big-O O(1).
   */
  public async release(actionName: string, key: string): Promise<void> {
    const lockKey = this.compositeKey(actionName, key);
    await this.client.eval(RELEASE_LUA, [lockKey], [this.workerToken]);
  }

  /**
   * @purpose Retrieves an existing idempotency record without modifying lock state.
   * @rationale Inspects whether an operation has already completed or is currently running.
   * @preconditions actionName and key must be non-empty strings.
   * @param actionName Target action name.
   * @param key Unique client idempotency key.
   * @returns Existing IdempotencyRecord or undefined if not found.
   * @throws Never throws unhandled.
   * @invariants Big-O O(1).
   */
  public async get(actionName: string, key: string): Promise<IdempotencyRecord | undefined> {
    const lockKey = this.compositeKey(actionName, key);
    const raw = await this.client.get(lockKey);
    if (!raw) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as IdempotencyRecord;
    } catch {
      return undefined;
    }
  }
}

/**
 * @purpose Declarative factory for creating a RedisIdempotencyStore instance.
 * @rationale Convenience entrypoint wrapping RedisStoreOptions into an IdempotencyStore.
 * @preconditions options must provide an initialized RedisClient.
 * @param options Configuration options including RedisClient instance.
 * @returns Fully configured RedisIdempotencyStore.
 * @throws Never throws during creation.
 * @invariants Pure factory function; Big-O O(1).
 */
export function createRedisIdempotencyStore(options: RedisStoreOptions): RedisIdempotencyStore {
  return new RedisIdempotencyStore(options);
}
