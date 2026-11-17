/**
 * @purpose In-memory Redis client mock for testing @shukoi/store-redis without external Redis dependencies.
 * @rationale Simulates Redis atomic Lua scripts (ACQUIRE_LUA, COMPLETE_LUA, RELEASE_LUA) and key operations in memory.
 * @preconditions None.
 * @invariants Pure in-memory simulation; Big-O O(1) operations.
 */

import type { RedisClient } from './types.js';

interface StorageEntry {
  value: string;
  expiresAt: number;
}

/**
 * @purpose Mock RedisClient implementation simulating atomic script execution in memory.
 * @rationale Validates RedisIdempotencyStore behavior, concurrent locking, completion, and release in CI test suites.
 * @invariants Thread-safe single-event-loop simulation; auto-expires keys by timestamp.
 */
export class MockRedisClient implements RedisClient {
  private readonly storage = new Map<string, StorageEntry>();

  private getActiveValue(key: string): string | null {
    const entry = this.storage.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.storage.delete(key);
      return null;
    }
    return entry.value;
  }

  /**
   * @purpose Evaluates simulated Lua script in memory.
   * @rationale Mimics Redis EVAL atomic execution across idempotency scripts.
   * @preconditions keys array must contain target key as first element.
   * @param script Script identifier or Lua content.
   * @param keys Keys passed to script.
   * @param args Arguments passed to script.
   * @returns Simulated Lua script evaluation result tuple or number.
   * @throws Error if key is missing or script is unrecognized.
   * @invariants Big-O O(1).
   */
  public async eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> {
    const key = keys[0];
    if (!key) {
      throw new Error('MockRedisClient: No key provided');
    }

    const current = this.getActiveValue(key);

    // 1. ACQUIRE_LUA Simulation
    if (script.includes("return { 'ACQUIRED', record }")) {
      const workerToken = String(args[0]);
      const ttlMs = Number(args[1]);
      const now = Number(args[2]);
      const actionName = String(args[3]);
      const idempKey = String(args[4]);

      if (!current) {
        const record = JSON.stringify({
          actionName,
          key: idempKey,
          status: 'IN_PROGRESS',
          lockToken: workerToken,
          expiresAt: now + ttlMs,
        });
        this.storage.set(key, { value: record, expiresAt: now + ttlMs });
        return ['ACQUIRED', record];
      }

      const decoded = JSON.parse(current) as { status: string };
      if (decoded.status === 'IN_PROGRESS') {
        return ['CONFLICT', current];
      }
      if (decoded.status === 'COMPLETED') {
        return ['COMPLETED', current];
      }
      return ['UNKNOWN', current];
    }

    // 2. COMPLETE_LUA Simulation
    if (script.includes("redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])")) {
      const workerToken = String(args[0]);
      const record = String(args[1]);
      const ttlMs = Number(args[2]);
      const now = Date.now();

      if (current) {
        const decoded = JSON.parse(current) as { lockToken?: string; status?: string };
        if (decoded.lockToken === workerToken || decoded.status === 'IN_PROGRESS') {
          this.storage.set(key, { value: record, expiresAt: now + ttlMs });
          return 1;
        }
      }
      this.storage.set(key, { value: record, expiresAt: now + ttlMs });
      return 1;
    }

    // 3. RELEASE_LUA Simulation
    if (script.includes("redis.call('DEL', KEYS[1])")) {
      const workerToken = String(args[0]);
      if (current) {
        const decoded = JSON.parse(current) as { lockToken?: string; status?: string };
        if (
          decoded.status === 'IN_PROGRESS' &&
          (workerToken === '' || decoded.lockToken === workerToken)
        ) {
          this.storage.delete(key);
          return 1;
        }
      }
      return 0;
    }

    throw new Error('MockRedisClient: Unhandled script');
  }

  /**
   * @purpose Retrieves stored string value for key.
   * @rationale Simulates Redis GET command with timestamp TTL expiry.
   * @preconditions key must be a non-empty string.
   * @param key Storage lookup key.
   * @returns Value or null if expired/absent.
   * @throws Never throws.
   * @invariants Big-O O(1).
   */
  public async get(key: string): Promise<string | null> {
    return this.getActiveValue(key);
  }

  /**
   * @purpose Sets key to value with optional TTL.
   * @rationale Simulates Redis SET command with PX expiration.
   * @preconditions key and value must be non-empty strings.
   * @param key Storage key.
   * @param value String payload.
   * @param mode Optional mode ('PX').
   * @param duration Optional TTL duration in milliseconds.
   * @returns Status string 'OK'.
   * @throws Never throws.
   * @invariants Big-O O(1).
   */
  public async set(key: string, value: string, mode?: string, duration?: number): Promise<unknown> {
    const ttl = mode === 'PX' && duration ? duration : 86400000;
    this.storage.set(key, { value, expiresAt: Date.now() + ttl });
    return 'OK';
  }

  /**
   * @purpose Deletes key from storage.
   * @rationale Simulates Redis DEL command.
   * @preconditions key must be a non-empty string.
   * @param key Storage key.
   * @returns 1 if deleted, 0 if not present.
   * @throws Never throws.
   * @invariants Big-O O(1).
   */
  public async del(key: string): Promise<number> {
    const deleted = this.storage.delete(key);
    return deleted ? 1 : 0;
  }

  /**
   * @purpose Clears all keys from simulated storage.
   * @rationale Simulates clean client teardown.
   * @preconditions None.
   * @param None
   * @returns Promise resolving when clear completes.
   * @throws Never throws.
   * @invariants Big-O O(1).
   */
  public async quit(): Promise<void> {
    this.storage.clear();
  }
}
