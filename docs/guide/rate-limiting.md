# Rate Limiting & Quota Management

> **Universal distributed rate limiting (Sliding Window & Token Bucket) with IETF RFC headers and RFC 9457 integration.**

High-throughput REST APIs and AI Agent services (such as Model Context Protocol servers) require strict ingress protection against denial-of-service (DoS) attacks, brute-force attempts, and LLM token quota exhaustion.

`@shukoi/ratelimit` delivers a modular, enterprise-grade rate limiter that enforces quota boundaries using either moving time windows or token buckets.

---

## 1. Algorithm Selection

| Algorithm | Function | Best For | Behavior |
| :--- | :--- | :--- | :--- |
| **Sliding Window Counter** | `slidingWindow()` | Public REST APIs, Webhooks, Auth Endpoints | Smooth request pacing across a moving time window; completely eliminates boundary burst spikes. |
| **Token Bucket** | `tokenBucket()` | AI Agents, LLM Token Quotas, Batch Ingestion | Permits controlled traffic bursts up to bucket capacity while strictly enforcing long-term replenishment rates. |

---

## 2. Standard IETF & RFC 9457 Headers

Every evaluated request receives standard IETF Draft-08 rate limit headers:

```http
HTTP/1.1 200 OK
RateLimit-Limit: 100
RateLimit-Remaining: 94
RateLimit-Reset: 14
RateLimit-Policy: 100;w=60
```

When an identifier exceeds its allocated quota, Shukoi halts execution and returns an HTTP `429 Too Many Requests` envelope adhering to **RFC 9457 (Problem Details for HTTP APIs)**:

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/problem+json
RateLimit-Limit: 100
RateLimit-Remaining: 0
RateLimit-Reset: 14
RateLimit-Policy: 100;w=60
Retry-After: 14

{
  "type": "https://shukoi.dev/errors/RATE_LIMIT_EXCEEDED",
  "title": "Too Many Requests",
  "status": 429,
  "detail": "Rate limit exceeded. Try again in 14 second(s).",
  "code": "RATE_LIMIT_EXCEEDED"
}
```

---

## 3. Storage Backends & Zero Memory Leak Guarantee

1. **In-Memory Bounded LRU (`BoundedLruCache`):**
   - Ideal for single-instance Node/Bun servers and automated unit tests.
   - Enforces a strict maximum capacity (`maxMemoryEntries: 10_000`) with auto-eviction of oldest entries, guaranteeing that memory consumption is strictly $O(1)$ even under millions of distinct attacking IPs.
2. **Distributed Redis Backend:**
   - Evaluates rate limiting in a single atomic Lua script call inside Redis (`SLIDING_WINDOW_LUA` with batch unpacked `ZADD` or `TOKEN_BUCKET_LUA` in a Redis Hash).
   - Eliminates race conditions across multiple serverless functions or container replicas.

---

## 4. Usage Examples

### Example 1: In-Memory Sliding Window (100 req / 60s)

```typescript
import { createRateLimiter, slidingWindow } from '@shukoi/ratelimit';

const limiter = createRateLimiter({
  keyPrefix: 'app:rl:',
  algorithm: slidingWindow({
    limit: 100,
    windowMs: 60_000,
    maxMemoryEntries: 10_000,
  }),
});

// Ingress handler or middleware:
const clientIp = req.headers['x-forwarded-for'] || '127.0.0.1';
const decision = await limiter.limit(`ip:${clientIp}`);

if (!decision.success) {
  const headers = limiter.getHeaders(decision, 60);
  return new Response('Rate limit exceeded', { status: 429, headers });
}
```

### Example 2: Distributed Redis Sliding Window

When connecting to Redis, normalize standard drivers (`ioredis` or `node-redis`) to Shukoi's `RateLimitRedisClient` contract via `wrapRedisClient()`:

```typescript
import { createRateLimiter, slidingWindow } from '@shukoi/ratelimit';
import { wrapRedisClient } from '@shukoi/store-redis';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

const distributedLimiter = createRateLimiter({
  algorithm: slidingWindow({
    limit: 1000,
    windowMs: 60_000,
    client: wrapRedisClient(redis),
  }),
});
```

### Example 3: Token Bucket for AI Agent LLM Tokens (In-Memory & Distributed Redis)

```typescript
import { createRateLimiter, tokenBucket } from '@shukoi/ratelimit';
import { wrapRedisClient } from '@shukoi/store-redis';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

// Allow burst up to 50,000 tokens, replenishing at 5,000 tokens per second across Redis cluster
const llmLimiter = createRateLimiter({
  algorithm: tokenBucket({
    capacity: 50_000,
    refillRate: 5_000,
    intervalMs: 1_000,
    client: wrapRedisClient(redis),
  }),
  keyPrefix: 'rate:llm:',
});

// Deduct estimated token cost before invoking LLM:
const estimatedTokens = 1_250;
await llmLimiter.assert(`user:${userId}`, estimatedTokens);
```
