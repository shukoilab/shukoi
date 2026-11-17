---
name: shukoi-distributed-resilience
description: Guides implementing distributed idempotency locking and rate limiting using @shukoi/store-redis and @shukoi/ratelimit in Shukoi applications. Use whenever state-mutating actions require exactly-once execution or ingress endpoints need DoS protection.
compatibility: TypeScript 5.5+, @shukoi/core, @shukoi/store-redis, @shukoi/ratelimit
---

# Implementing Distributed Resilience in Shukoi

## Core Invariants for AI Coding Agents

1. **Atomic State Transitions:** Always use `@shukoi/store-redis` atomic Lua scripts (`acquireOrReplay`, `completeExecution`, `release`) for distributed idempotency locks. Never attempt manual check-then-set logic outside atomic scripts.
2. **Zero Memory Leaks:** Always enforce bounded memory capacity when using in-memory fallbacks (`BoundedLruCache(10000)`). Unbounded `Map` or `Set` instances are strictly prohibited.
3. **Pure Web-Standard Edge Runtimes:** In Cloudflare Workers or V8 Isolates, use `@shukoi/store-redis/edge` with `UpstashRedisClient` (fetch-based). Never import `node:net` or `node:tls`.
4. **Strict Cost Parameter Sanitization:** Any rate limit token consumption cost MUST be validated as a positive integer ($\ge 1$).

---

## 1. Configuring Distributed Idempotency

### A. Persistent Containers (Node.js 22+ / Bun 1.2+ with ioredis)

```typescript
import { createRestRouter } from '@shukoi/api';
import { createRedisIdempotencyStore } from '@shukoi/store-redis/node';
import Redis from 'ioredis';
import { paymentAction } from './actions/payment.js';
import { config } from './config.js';

const redis = new Redis(process.env.REDIS_URL!);
const idempotencyStore = createRedisIdempotencyStore({
  client: redis,
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

export default toCloudflareWorker((env) => {
  const idempotencyStore = createRedisIdempotencyStore({
    client: new UpstashRedisClient({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    }),
  });

  return createRestRouter([paymentAction], config, { idempotencyStore });
});
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
  }),
});

// Middleware evaluation:
const decision = await apiRateLimiter.limit(`ip:${clientIp}`);
if (!decision.success) {
  const headers = apiRateLimiter.getHeaders(decision);
  // Returns 429 Too Many Requests with IETF headers
}
```

### B. Token Bucket for AI Agents / LLM Quotas

```typescript
import { createRateLimiter, tokenBucket } from '@shukoi/ratelimit';

export const llmTokenLimiter = createRateLimiter({
  algorithm: tokenBucket({
    capacity: 20000,
    refillRate: 2000,
    intervalMs: 1000,
  }),
});

// Deduct estimated token cost before executing prompt:
await llmTokenLimiter.assert(`user:${userId}`, estimatedTokens);
```
