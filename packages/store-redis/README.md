# @shukoi/store-redis

> **Distributed Redis Idempotency Lock Store with Atomic Lua Scripts & Edge HTTP Fallback for Shukoi**

[![npm version](https://img.shields.io/npm/v/@shukoi/store-redis.svg)](https://www.npmjs.com/package/@shukoi/store-redis)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`@shukoi/store-redis` implements the `@shukoi/core` `IdempotencyStore` interface backed by Redis. It serializes concurrent requests using atomic Lua scripts, guarantees exactly-once execution across multi-instance Kubernetes clusters, AWS Lambda instances, and Cloudflare Workers, and provides zero-dependency Web-standard HTTP REST connectivity for edge isolates.

---

## Key Features & Invariants

- **Atomic Lua Locking:** State transitions (`UNLOCKED` -> `IN_PROGRESS` -> `COMPLETED`) occur in a single atomic Redis engine tick, preventing Time-of-Check to Time-of-Use (TOCTOU) race conditions.
- **Dual Runtime Support:** Compatible with standard TCP Redis clients (`ioredis`, `node-redis`) and Web-standard HTTP fetch clients (`@upstash/redis`) with 0 `node:*` imports on edge runtimes.
- **Auto-Expiring Locks:** Enforces explicit PX TTL on in-progress locks, preventing deadlocks if a container crashes mid-execution.
- **Payload Caching & Replay:** Replays completed responses instantly and emits `Idempotent-Replayed: true`.
- **In-Memory Mock Double:** Ships with `@shukoi/store-redis/testing` for deterministic unit testing without external Redis servers.

---

## Installation

```bash
pnpm add @shukoi/store-redis @shukoi/core
```

---

## Usage

```typescript
import { createRedisIdempotencyStore, UpstashRedisClient } from '@shukoi/store-redis';

// Option A: Upstash / Cloudflare Workers (Pure Web fetch)
const store = createRedisIdempotencyStore({
  client: new UpstashRedisClient({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  }),
});

// Option B: Standard ioredis / Node.js
import Redis from 'ioredis';
const store = createRedisIdempotencyStore({
  client: new Redis(process.env.REDIS_URL),
});
```
