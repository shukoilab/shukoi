# @shukoi/ratelimit

> **Universal Distributed Rate Limiter (Sliding Window & Token Bucket) with IETF Draft-08 Headers for Shukoi**

[![npm version](https://img.shields.io/npm/v/@shukoi/ratelimit.svg)](https://www.npmjs.com/package/@shukoi/ratelimit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`@shukoi/ratelimit` provides production-grade rate limiting protection for Shukoi REST APIs and Model Context Protocol (MCP) agents. It supports both **Sliding Window Counter** (smooth, boundary burst-free) and **Token Bucket** (burst-tolerant for LLM token quotas), backed by atomic Redis Lua scripts or bounded in-memory LRU stores with $O(1)$ memory guarantees.

---

## Key Features & Invariants

- **Dual Algorithms:**
  - `slidingWindow()`: Exact timestamped sliding window counter using Redis Sorted Sets (`ZSET`) with batch unpacked `ZADD` for cost > 1.
  - `tokenBucket()`: Continuous token replenishment using Redis Hashes (`HMGET`/`HSET`) for LLM/AI token quotas.
- **Dual Backends:** Distributed Redis backend (via atomic single-roundtrip Lua scripts) and bounded in-memory LRU fallback (`BoundedLruCache(10000)` with $O(1)$ space ceiling).
- **IETF Draft-08 Compliant Headers:** `getHeaders()` emits `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `RateLimit-Policy` (`<limit>;w=<windowSec>`), and conditional `Retry-After`.
- **RFC 9457 Integration:** Calling `limiter.assert()` throws standard `DomainError('RATE_LIMIT_EXCEEDED', ..., 429)` Problem Details envelopes.
- **Strict Input Validation:** `cost` parameter is validated as a positive integer ($\ge 1$). Negative, zero, fractional, or `NaN` values throw `DomainError('VALIDATION_ERROR', ..., 422)`.
- **Pure Web Standard:** Zero `node:*` imports; 100% compatible with Cloudflare Workers V8 Isolates, Bun, and Node.js.
- **In-Memory Testing Double:** Ships with `@shukoi/ratelimit/testing` featuring `MockRateLimitRedisClient` for deterministic unit testing.

---

## Installation

```bash
pnpm add @shukoi/ratelimit @shukoi/core
```

---

## Usage

### 1. In-Memory Sliding Window (Local Services & Workers)

```typescript
import { createRateLimiter, slidingWindow } from '@shukoi/ratelimit';

// Allow 100 requests per 60 seconds per IP
const limiter = createRateLimiter({
  algorithm: slidingWindow({
    limit: 100,
    windowMs: 60_000,
    maxMemoryEntries: 10_000, // LRU bounded capacity
  }),
  keyPrefix: 'rate:api:',
});

// Method A: Check decision manually
const decision = await limiter.limit('ip:192.168.1.1');
const headers = limiter.getHeaders(decision, 60);

if (!decision.success) {
  return new Response('Rate limit exceeded', { status: 429, headers });
}

// Method B: Fail fast with 429 DomainError
await limiter.assert('ip:192.168.1.1');
```

### 2. Distributed Token Bucket in Redis (LLM / AI Token Quotas)

Ideal for managing AI model token budgets across multi-pod Kubernetes clusters:

```typescript
import { createRateLimiter, tokenBucket } from '@shukoi/ratelimit';
import { wrapRedisClient } from '@shukoi/store-redis';
import Redis from 'ioredis';

// ioredis client normalized to RateLimitRedisClient contract
const redisClient = wrapRedisClient(new Redis(process.env.REDIS_URL!));

// Bucket capacity of 10,000 tokens, replenishing 500 tokens every 1000ms
const tokenLimiter = createRateLimiter({
  algorithm: tokenBucket({
    capacity: 10_000,
    refillRate: 500,
    intervalMs: 1_000,
    client: redisClient,
  }),
  keyPrefix: 'rate:llm:',
});

// Deduct cost based on estimated prompt + completion tokens
const result = await tokenLimiter.limit('user:usr_123', 250);
if (!result.success) {
  console.log(`Tokens depleted! Retry in ${result.retryAfter}s`);
}
```

---

## Configuration Options

### `SlidingWindowOptions`

| Option             | Type                   | Default      | Description                                                        |
| :----------------- | :--------------------- | :----------- | :----------------------------------------------------------------- |
| `limit`            | `number`               | **Required** | Maximum allowed units within the window.                           |
| `windowMs`         | `number`               | **Required** | Rolling window size in milliseconds.                               |
| `client`           | `RateLimitRedisClient` | `undefined`  | Optional Redis client for distributed multi-instance tracking.     |
| `maxMemoryEntries` | `number`               | `10000`      | Maximum LRU entries retained in memory when running without Redis. |

### `TokenBucketOptions`

| Option             | Type                   | Default      | Description                                                        |
| :----------------- | :--------------------- | :----------- | :----------------------------------------------------------------- |
| `capacity`         | `number`               | **Required** | Maximum burst capacity of tokens in the bucket.                    |
| `refillRate`       | `number`               | **Required** | Number of tokens added per interval.                               |
| `intervalMs`       | `number`               | `1000` (1s)  | Replenishment tick interval in milliseconds.                       |
| `client`           | `RateLimitRedisClient` | `undefined`  | Optional Redis client for distributed Redis Hash evaluation.       |
| `maxMemoryEntries` | `number`               | `10000`      | Maximum LRU entries retained in memory when running without Redis. |

---

## API Reference

### `limiter.limit(identifier: string, cost = 1): Promise<RateLimitResult>`

Evaluates rate limit availability and deducts `cost` on success:

```typescript
interface RateLimitResult {
  readonly success: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetMs: number;
  readonly retryAfter: number; // 0 on success, >= 1 on breach
}
```

### `limiter.assert(identifier: string, cost = 1): Promise<RateLimitResult>`

Evaluates availability; throws `DomainError('RATE_LIMIT_EXCEEDED', ..., 429)` if breached.

### `limiter.getHeaders(result: RateLimitResult, policyWindowSec?: number): Record<string, string>`

Formats decision into standard IETF Draft-08 response headers:

```http
RateLimit-Limit: 100
RateLimit-Remaining: 99
RateLimit-Reset: 60
RateLimit-Policy: 100;w=60
Retry-After: 5  <-- emitted only when success is false
```

---

## Testing Without Redis

Use `MockRateLimitRedisClient` from `@shukoi/ratelimit/testing` in unit test suites:

```typescript
import { createRateLimiter, slidingWindow } from '@shukoi/ratelimit';
import { MockRateLimitRedisClient } from '@shukoi/ratelimit/testing';

const redisMock = new MockRateLimitRedisClient();
const limiter = createRateLimiter({
  algorithm: slidingWindow({ limit: 10, windowMs: 1000, client: redisMock }),
});
```
