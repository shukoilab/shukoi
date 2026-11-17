---
name: shukoi-distributed-resilience
description: Guides implementing distributed idempotency locking and rate limiting using @shukoi/store-redis and @shukoi/ratelimit in Shukoi applications. Use whenever state-mutating actions require exactly-once execution or ingress endpoints need DoS protection.
compatibility: TypeScript 5.5+, @shukoi/core, @shukoi/store-redis, @shukoi/ratelimit
---

# Implementing Distributed Resilience in Shukoi

## Core Invariants for AI Coding Agents

1. **Atomic State Transitions:** Always use `@shukoi/store-redis` atomic Lua scripts (`ACQUIRE_LUA`, `COMPLETE_LUA`, `RELEASE_LUA`, `EXTEND_LUA`) and methods (`tryAcquire`, `complete`, `release`, `extendLock`). Never attempt manual check-then-set logic outside atomic scripts.
2. **Multi-Driver Normalization:** Always use `wrapRedisClient(client)` when connecting `ioredis` or `node-redis` to `@shukoi/store-redis` or `@shukoi/ratelimit` to normalize driver-specific `eval` signatures.
3. **Zero Memory Leaks:** Always enforce bounded memory capacity when using in-memory fallbacks (`BoundedLruCache(10000)`). Unbounded `Map` or `Set` instances are strictly prohibited.
4. **Pure Web-Standard Edge Runtimes:** In Cloudflare Workers or V8 Isolates, use `@shukoi/store-redis/edge` with `UpstashRedisClient` (fetch-based). Never import `node:*` modules.
5. **Strict Cost Parameter Sanitization:** Any rate limit token consumption cost MUST be validated as a positive integer ($\ge 1$). Negative, zero, or non-integer costs throw `DomainError('VALIDATION_ERROR', ..., 422)`.
6. **IETF Draft-08 Header Compliance:** `limiter.getHeaders()` emits `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `RateLimit-Policy` (`<limit>;w=<windowSec>`), and conditional `Retry-After`.

---

## 1. Configuring Distributed Idempotency

### A. Persistent Containers (Node.js 22+ / Bun 1.2+ with ioredis or node-redis)

```typescript
import { createRestRouter } from '@shukoi/api';
import { createRedisIdempotencyStore, wrapRedisClient } from '@shukoi/store-redis/node';
import Redis from 'ioredis';
import { paymentAction } from './actions/payment.js';
import { config } from './config.js';

const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: 3,
  commandTimeout: 5000,
});

const idempotencyStore = createRedisIdempotencyStore({
  client: wrapRedisClient(redis),
  keyPrefix: 'shukoi:idemp:',
  defaultLockTtlMs: 30000,
  defaultRetentionTtlMs: 86400000,
});

export const app = createRestRouter([paymentAction], config, { idempotencyStore });
```

### B. Cloudflare Workers (V8 Isolates with Upstash REST)

```typescript
import { createRestRouter } from '@shukoi/api';
import { toCloudflareWorker } from '@shukoi/cloudflare';
import { createRedisIdempotencyStore, UpstashRedisClient } from '@shukoi/store-redis/edge';
import { paymentAction } from './actions/payment.js';
import { config } from './config.js';

export const app = createRestRouter([paymentAction], config);

export default toCloudflareWorker(app);
```

### C. Heartbeat Renewal for Long-Running Operations

```typescript
// Extends active lock TTL during long-running async computations
const renewed = await idempotencyStore.extendLock('paymentAction', key, 30_000);
```

---

## 2. Implementing Rate Limiting

### A. Sliding Window Counter (Zero Boundary Burst)

```typescript
import { createRateLimiter, slidingWindow } from '@shukoi/ratelimit';

export const apiRateLimiter = createRateLimiter({
  keyPrefix: 'app:rl:',
  algorithm: slidingWindow({
    limit: 100,
    windowMs: 60000,
    maxMemoryEntries: 10000,
  }),
});

// Middleware evaluation:
const decision = await apiRateLimiter.limit(`ip:${clientIp}`);
if (!decision.success) {
  const headers = apiRateLimiter.getHeaders(decision, 60);
  // Returns 429 Too Many Requests with IETF headers including RateLimit-Policy
}
```

### B. Distributed Token Bucket for AI Agents / LLM Quotas

```typescript
import { createRateLimiter, tokenBucket } from '@shukoi/ratelimit';
import { wrapRedisClient } from '@shukoi/store-redis';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

export const llmTokenLimiter = createRateLimiter({
  algorithm: tokenBucket({
    capacity: 20000,
    refillRate: 2000,
    intervalMs: 1000,
    client: wrapRedisClient(redis),
  }),
  keyPrefix: 'app:llm:',
});

// Deduct estimated token cost before executing prompt:
await llmTokenLimiter.assert(`user:${userId}`, estimatedTokens);
```
