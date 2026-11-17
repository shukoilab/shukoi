/**
 * @purpose Universal Redis client normalization adapter for 3rd-party drivers.
 * @rationale Bridges differences in eval() signatures across ioredis, node-redis v4+, and @upstash/redis.
 * @preconditions Target client instance must support eval, get, set, and del commands.
 * @invariants Pure TypeScript adapter; zero external dependencies; thread-safe.
 */

import type { RedisClient } from './types.js';

/**
 * @purpose Normalizes any third-party Redis driver instance into Shukoi's standard RedisClient contract.
 * @rationale Auto-detects driver flavor (ioredis positional, node-redis options object, or native) and standardizes eval dispatch.
 * @preconditions client must be an object implementing basic Redis commands (eval, get, set, del).
 * @param client Third-party Redis client instance (ioredis, node-redis, upstash, or custom).
 * @returns Fully normalized RedisClient adhering to Shukoi's contract.
 * @throws Error if client does not provide an eval or command method.
 * @invariants Big-O O(1) command delegation overhead; thread-safe.
 */
export function wrapRedisClient(client: unknown): RedisClient {
  if (!client || typeof client !== 'object') {
    throw new Error('wrapRedisClient requires a valid Redis client object');
  }

  const candidate = client as Record<string, unknown>;

  // Check if it's already an instance conforming to Shukoi's RedisClient
  if (
    typeof candidate['eval'] === 'function' &&
    typeof candidate['get'] === 'function' &&
    typeof candidate['set'] === 'function' &&
    typeof candidate['del'] === 'function'
  ) {
    // Detect whether eval expects node-redis options object or ioredis positional parameters
    const isNodeRedis =
      'isOpen' in candidate ||
      'isReady' in candidate ||
      (typeof candidate['execute'] === 'function' && !('status' in candidate));

    const isIoredis =
      'status' in candidate || 'options' in candidate || typeof candidate['call'] === 'function';

    if (isNodeRedis) {
      return {
        eval: async (script: string, keys: string[], args: (string | number)[]) => {
          const evalFn = candidate['eval'] as (
            s: string,
            opts: { keys?: string[]; arguments?: string[] },
          ) => Promise<unknown>;
          return await evalFn.call(candidate, script, {
            keys,
            arguments: args.map(String),
          });
        },
        get: async (key: string) => {
          const fn = candidate['get'] as (k: string) => Promise<string | null>;
          return await fn.call(candidate, key);
        },
        set: async (key: string, value: string, mode?: string, duration?: number) => {
          const fn = candidate['set'] as (...a: unknown[]) => Promise<unknown>;
          if (mode === 'PX' && duration !== undefined) {
            return await fn.call(candidate, key, value, { PX: duration });
          }
          if (mode === 'EX' && duration !== undefined) {
            return await fn.call(candidate, key, value, { EX: duration });
          }
          return await fn.call(candidate, key, value);
        },
        del: async (key: string) => {
          const fn = candidate['del'] as (k: string) => Promise<number>;
          return await fn.call(candidate, key);
        },
        quit: async () => {
          if (typeof candidate['quit'] === 'function') {
            await (candidate['quit'] as () => Promise<void>).call(candidate);
          }
        },
      };
    }

    if (isIoredis) {
      return {
        eval: async (script: string, keys: string[], args: (string | number)[]) => {
          const evalFn = candidate['eval'] as (
            s: string,
            num: number,
            ...rest: (string | number)[]
          ) => Promise<unknown>;
          return await evalFn.call(candidate, script, keys.length, ...keys, ...args);
        },
        get: async (key: string) => {
          const fn = candidate['get'] as (k: string) => Promise<string | null>;
          return await fn.call(candidate, key);
        },
        set: async (key: string, value: string, mode?: string, duration?: number) => {
          const fn = candidate['set'] as (...a: unknown[]) => Promise<unknown>;
          if (mode && duration !== undefined) {
            return await fn.call(candidate, key, value, mode, duration);
          }
          return await fn.call(candidate, key, value);
        },
        del: async (key: string) => {
          const fn = candidate['del'] as (k: string) => Promise<number>;
          return await fn.call(candidate, key);
        },
        quit: async () => {
          if (typeof candidate['quit'] === 'function') {
            await (candidate['quit'] as () => Promise<void>).call(candidate);
          }
        },
      };
    }

    // Default: Assume native Shukoi / Upstash style client
    return candidate as unknown as RedisClient;
  }

  throw new Error('Unsupported Redis client object: missing required Redis command methods');
}
