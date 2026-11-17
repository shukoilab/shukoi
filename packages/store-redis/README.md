# @shukoi/store-redis

> **Distributed Redis Idempotency Lock Store with Atomic Lua Scripts & Multi-Driver Normalization for Shukoi**

[![npm version](https://img.shields.io/npm/v/@shukoi/store-redis.svg)](https://www.npmjs.com/package/@shukoi/store-redis)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`@shukoi/store-redis` implements the `@shukoi/core` `IdempotencyStore` interface backed by Redis. It serializes concurrent requests using atomic Lua scripts, guarantees exactly-once execution across multi-instance Kubernetes clusters, AWS Lambda instances, and Cloudflare Workers, and provides zero-dependency Web-standard HTTP REST connectivity for edge isolates.

---

## Key Features & Invariants

- **Atomic Lua State Machine:** State transitions (`IN_PROGRESS` -> `COMPLETED`) occur in a single atomic Redis engine tick via `ACQUIRE_LUA`, `COMPLETE_LUA`, `RELEASE_LUA`, and `EXTEND_LUA`, preventing Time-of-Check to Time-of-Use (TOCTOU) race conditions.
- **Resilient JSON Parsing:** Lua scripts use safe `pcall(cjson.decode, current)` error handling to prevent script termination on corrupted payloads or non-JSON keys.
- **Heartbeat Lock Extension:** Provides `extendLock(actionName, key, additionalTtlMs?)` to safely renew active in-progress lock TTL during long-running async computations.
- **Multi-Driver Normalization:** Transparently adapts `ioredis` (positional args), `node-redis` (v4/v5 options object), and `@upstash/redis` to Shukoi's `RedisClient` contract via `wrapRedisClient()`.
- **Pure Web-Standard Edge Runtime:** The `./edge` subpath and `UpstashRedisClient` contain 0 `node:*` imports, operating natively in Cloudflare Workers and V8 Isolates.
- **Auto-Expiring Locks:** Enforces explicit PX TTL on in-progress locks, preventing deadlocks if a container crashes mid-execution.
- **In-Memory Testing Double:** Ships with `@shukoi/store-redis/testing` featuring `MockRedisClient` for deterministic unit testing without external Redis servers.

---

## Installation

```bash
pnpm add @shukoi/store-redis @shukoi/core
```

---

## Driver Configuration & Setup

### Option A: Cloudflare Workers / Edge (Native Upstash HTTP)

For Cloudflare Workers or serverless edge runtimes, use the built-in `UpstashRedisClient` (uses Web-standard `fetch`, 0 external dependencies):

```typescript
import { createRedisIdempotencyStore, UpstashRedisClient } from '@shukoi/store-redis';

export const idempotencyStore = createRedisIdempotencyStore({
  client: new UpstashRedisClient({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  }),
  keyPrefix: 'myapp:idemp:',
  defaultLockTtlMs: 30_000, // 30 seconds lock TTL
  defaultRetentionTtlMs: 86_400_000, // 24 hours response caching
});
```

> **Note on `@upstash/redis` SDK:** If you use the official `@upstash/redis` npm package instead of `UpstashRedisClient`, you **must** pass `{ automaticDeserialization: false }` to avoid double-deserialization failures:
>
> ```typescript
> import { Redis } from '@upstash/redis';
> import { createRedisIdempotencyStore, wrapRedisClient } from '@shukoi/store-redis';
>
> const store = createRedisIdempotencyStore({
>   client: wrapRedisClient(new Redis({ url: '...', token: '...', automaticDeserialization: false })),
> });
> ```

### Option B: Node.js / Bun (`ioredis`)

When using `ioredis`, wrap the client instance with `wrapRedisClient()`:

```typescript
import Redis from 'ioredis';
import { createRedisIdempotencyStore, wrapRedisClient } from '@shukoi/store-redis';

const ioredis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  commandTimeout: 5000,
});

export const idempotencyStore = createRedisIdempotencyStore({
  client: wrapRedisClient(ioredis),
  defaultLockTtlMs: 30_000,
});
```

### Option C: Node.js / Bun (`node-redis` v4/v5)

When using `@redis/client` or `redis`:

```typescript
import { createClient } from 'redis';
import { createRedisIdempotencyStore, wrapRedisClient } from '@shukoi/store-redis';

const nodeRedis = createClient({ url: process.env.REDIS_URL });
await nodeRedis.connect();

export const idempotencyStore = createRedisIdempotencyStore({
  client: wrapRedisClient(nodeRedis),
});
```

---

## Configuration Options (`RedisStoreOptions`)

| Option                  | Type          | Default           | Description                                                                                           |
| :---------------------- | :------------ | :---------------- | :---------------------------------------------------------------------------------------------------- |
| `client`                | `RedisClient` | **Required**      | Redis client instance conforming to `eval(script, keys, args)` (or normalized via `wrapRedisClient`). |
| `keyPrefix`             | `string`      | `'shukoi:idemp:'` | Key namespace prefix for Redis keys.                                                                  |
| `defaultLockTtlMs`      | `number`      | `30000` (30s)     | In-progress lock expiration in milliseconds. Prevents deadlocks on worker crash.                      |
| `defaultRetentionTtlMs` | `number`      | `86400000` (24h)  | Completed record retention duration in milliseconds for replaying cached responses.                   |

---

## API Reference

### `createRedisIdempotencyStore(options: RedisStoreOptions): RedisIdempotencyStore`

Declarative factory constructing a thread-safe `RedisIdempotencyStore`.

### `store.tryAcquire(actionName, key, ttlMs?): Promise<{ acquired: boolean; record?: IdempotencyRecord }>`

Atomically attempts to acquire an in-progress lock. Throws `DomainError('CONFLICT', ..., 409)` if an operation with the same key is currently running. If already completed, returns `{ acquired: false, record }` with the cached response payload.

### `store.complete(actionName, key, responsePayload, retentionTtlMs?): Promise<void>`

Atomically marks execution as `COMPLETED` and stores the response payload for future replay.

### `store.extendLock(actionName, key, additionalTtlMs?): Promise<boolean>`

Extends the active in-progress lock expiration (heartbeat pattern). Returns `true` if extended, or `false` if the lock expired or belongs to another worker.

```typescript
// Background heartbeat for long-running workflows
const heartbeat = setInterval(async () => {
  const renewed = await store.extendLock('heavyProcess', idempotencyKey, 30_000);
  if (!renewed) clearInterval(heartbeat);
}, 10_000);

try {
  await doLongWork();
} finally {
  clearInterval(heartbeat);
}
```

### `store.release(actionName, key): Promise<void>`

Releases an in-progress lock on unhandled failure, allowing client retries without waiting for TTL expiration.

### `store.get(actionName, key): Promise<IdempotencyRecord | undefined>`

Inspects current state without mutating lock status.

---

## Testing Without Redis

Use `MockRedisClient` from `@shukoi/store-redis/testing` for zero-network unit tests:

```typescript
import { createRedisIdempotencyStore } from '@shukoi/store-redis';
import { MockRedisClient } from '@shukoi/store-redis/testing';

const mockClient = new MockRedisClient();
const store = createRedisIdempotencyStore({ client: mockClient });
```
