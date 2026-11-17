# @shukoi/ratelimit

> **Universal Distributed Rate Limiter (Sliding Window & Token Bucket) with IETF RFC Headers for Shukoi**

[![npm version](https://img.shields.io/npm/v/@shukoi/ratelimit.svg)](https://www.npmjs.com/package/@shukoi/ratelimit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`@shukoi/ratelimit` provides production-grade rate limiting protection for Shukoi REST APIs and Model Context Protocol (MCP) agents. It supports both **Sliding Window Counter** (smooth, boundary burst-free) and **Token Bucket** (burst-tolerant for LLM token quotas), backed by atomic Redis Lua scripts or bounded in-memory LRU stores with $O(1)$ memory guarantees.

---

## Key Features & Invariants

- **Dual Algorithms:** Sliding Window Counter (exact moving window) and Token Bucket (continuous replenishment).
- **Dual Backends:** Distributed Redis backend (via atomic Lua script) and bounded In-Memory LRU fallback (`maxItems: 10_000`, 0 memory leaks).
- **IETF Standards Compliant:** Emits `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and `Retry-After`.
- **RFC 9457 Integration:** Yields standard `429 Too Many Requests` Problem Details envelopes upon limit breach.
- **Multiple Identifiers:** IP address extraction, API key hashing, authenticated user IDs, and composite keys.
- **Pure Web Standard:** Zero `node:*` imports in edge configurations.

---

## Installation

```bash
pnpm add @shukoi/ratelimit @shukoi/core
```

---

## Usage

```typescript
import { createRateLimiter, slidingWindow } from '@shukoi/ratelimit';

// In-Memory Sliding Window: 100 requests per 60 seconds
const limiter = createRateLimiter({
  algorithm: slidingWindow({
    limit: 100,
    windowMs: 60_000,
  }),
});

const result = await limiter.limit('ip:192.168.1.1');
if (!result.success) {
  // Reject request with 429
  console.log(`Rate limit exceeded! Retry after ${result.retryAfter}s`);
}
```
