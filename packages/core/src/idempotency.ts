/**
 * @purpose Atomic idempotency locking and response caching for state-mutating actions.
 * @rationale Guarantees exactly-once semantics for mutating endpoints and webhooks, preventing duplicate database mutations on client retries or network replays.
 * @preconditions Idempotency key must be a non-empty string.
 * @invariants Bounded capacity; TTL-based eviction; atomic lock transitions (UNLOCKED -> IN_PROGRESS -> COMPLETED).
 */

import { DomainError } from './errors.js';

/**
 * @purpose State record representing an acquired or completed idempotency lock.
 * @rationale Preserves execution status and cached responses across concurrent or replayed invocations.
 * @invariants Readonly state representation; immutable once completed.
 */
export interface IdempotencyRecord {
  readonly actionName: string;
  readonly key: string;
  readonly status: 'IN_PROGRESS' | 'COMPLETED';
  readonly responsePayload?: unknown;
  readonly expiresAt: number;
}

/**
 * @purpose Contract for pluggable idempotency lock storage engines (In-Memory, Redis, DynamoDB).
 * @rationale Decouples framework execution pipeline from concrete storage infrastructure.
 * @invariants Thread-safe, atomic operations across concurrent callers.
 */
export interface IdempotencyStore {
  tryAcquire(
    actionName: string,
    key: string,
    ttlMs: number,
  ): Promise<{ acquired: boolean; record?: IdempotencyRecord }>;
  complete(actionName: string, key: string, payload: unknown, ttlMs: number): Promise<void>;
  release(actionName: string, key: string): Promise<void>;
}

/**
 * @purpose In-memory bounded LRU idempotency lock store with automatic TTL expiration.
 * @rationale Provides zero-dependency, ultra-fast idempotency locking suitable for single-instance, test, and containerized deployments.
 * @preconditions maxEntries is a positive integer.
 * @invariants Bounded capacity; O(1) operations; memory leakage prevented via size bounds and lazy eviction.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly maxEntries: number;
  private readonly map = new Map<string, IdempotencyRecord>();

  public constructor(maxEntries = 10000) {
    this.maxEntries = maxEntries;
  }

  private compositeKey(actionName: string, key: string): string {
    return `${actionName}:${key}`;
  }

  /**
   * @purpose Attempts to atomically acquire an execution lock for a given action and idempotency key.
   * @rationale If an operation is currently IN_PROGRESS, subsequent calls fail fast with 409 Conflict. If COMPLETED, cached payload is returned.
   * @param actionName Qualified action identifier.
   * @param key Client-provided unique idempotency key.
   * @param ttlMs Time-to-live in milliseconds before lock automatically expires.
   * @returns Object indicating whether lock was acquired, plus existing record if present.
   * @throws DomainError('CONFLICT', ...) if another concurrent execution holds the lock.
   * @invariants Big-O time complexity O(1); atomic single-thread tick transition.
   */
  public async tryAcquire(
    actionName: string,
    key: string,
    ttlMs: number,
  ): Promise<{ acquired: boolean; record?: IdempotencyRecord }> {
    const composite = this.compositeKey(actionName, key);
    const now = Date.now();
    const existing = this.map.get(composite);

    if (existing) {
      if (now > existing.expiresAt) {
        // Expired lock, safely purge
        this.map.delete(composite);
      } else if (existing.status === 'IN_PROGRESS') {
        throw new DomainError(
          'CONFLICT',
          `Action "${actionName}" with idempotency key "${key}" is currently in progress`,
          409,
        );
      } else if (existing.status === 'COMPLETED') {
        return { acquired: false, record: existing };
      }
    }

    // Capacity bound check: evict oldest entry if at capacity
    if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }

    const record: IdempotencyRecord = {
      actionName,
      key,
      status: 'IN_PROGRESS',
      expiresAt: now + ttlMs,
    };

    this.map.set(composite, record);
    return { acquired: true, record };
  }

  /**
   * @purpose Marks an acquired idempotency lock as COMPLETED and caches its response payload.
   * @rationale Allows subsequent requests with the same idempotency key to receive immediate cached responses without re-executing business logic.
   * @param actionName Qualified action identifier.
   * @param key Client-provided unique idempotency key.
   * @param payload Final handler response payload to cache.
   * @param ttlMs Time-to-live in milliseconds to keep cached response.
   * @returns Promise resolving when cache state is updated.
   * @throws Never throws.
   * @invariants Big-O time complexity O(1); immutable completed record.
   */
  public async complete(
    actionName: string,
    key: string,
    payload: unknown,
    ttlMs: number,
  ): Promise<void> {
    const composite = this.compositeKey(actionName, key);
    const now = Date.now();
    const record: IdempotencyRecord = {
      actionName,
      key,
      status: 'COMPLETED',
      responsePayload: payload,
      expiresAt: now + ttlMs,
    };
    this.map.set(composite, record);
  }

  /**
   * @purpose Releases an acquired idempotency lock in the event of an unhandled handler failure.
   * @rationale Prevents orphaned locks from blocking subsequent retries when an operation fails before completion.
   * @param actionName Qualified action identifier.
   * @param key Client-provided unique idempotency key.
   * @returns Promise resolving when lock is cleared.
   * @throws Never throws.
   * @invariants Big-O time complexity O(1).
   */
  public async release(actionName: string, key: string): Promise<void> {
    const composite = this.compositeKey(actionName, key);
    this.map.delete(composite);
  }

  /**
   * @purpose Returns current active entry count in memory (used for testing and soak metrics).
   * @returns Number of active entries.
   * @throws Never throws.
   * @invariants O(1) size property access.
   */
  public get size(): number {
    return this.map.size;
  }
}
