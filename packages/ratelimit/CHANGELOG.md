# @shukoi/ratelimit

## 1.0.4

### Patch Changes

- Release v1.0.4: Hardening third-party integrations, multi-driver normalization, and documentation parity.
  
  - **@shukoi/store-redis**: Added `wrapRedisClient()` multi-driver adapter (`ioredis`, `node-redis` v4/v5, `@upstash/redis` with `{ automaticDeserialization: false }`), heartbeat lock renewal via `EXTEND_LUA` and `extendLock()`, and resilient `pcall(cjson.decode)` parsing.
  - **@shukoi/ratelimit**: Added distributed token bucket via `TOKEN_BUCKET_LUA` in Redis Hash, batch unpacked `ZADD` for sliding window, `limiter.assert()`, and IETF Draft-08 `RateLimit-Policy` headers.
  - **@shukoi/otel**: Emits OTLP 1.34+ compliant `service.name` in `resource.attributes`, added `SpanKind` support and `span.recordException()`, and grouped Prometheus metrics contiguously by metric family.
  - **@shukoi/auth**: Added $O(1)$ pre-hashed static API keys, mandatory session store in `createSessionCookieStrategy`, cached JWKS keystore, and `BoundedLruCache(5000)` memory protection for OIDC introspection.
  - **@shukoi/db**: Added ANSI SQL `TransactionIsolationLevel` across Drizzle, Kysely, and Prisma, and native Cloudflare D1 `batch()` multi-statement atomicity.
  - **create-shukoi**: Scaffolding templates and dependency synchronizer aligned with v1.0.4.
- Updated dependencies []:
  - @shukoi/core@1.0.4

## 1.0.3

### Initial Release & Hardening

- Initial release of `@shukoi/ratelimit`: Universal distributed and in-memory rate limiter for Shukoi applications.
- **Dual Algorithms**: Sliding Window Counter (exact moving window, boundary burst-free) and Token Bucket (burst-tolerant for LLM token quotas).
- **Distributed Token Bucket**: Introduced `TOKEN_BUCKET_LUA` backed by Redis Hash (`HMGET`/`HSET`) for atomic multi-pod LLM rate limiting.
- **Optimized Sliding Window**: Enhanced `SLIDING_WINDOW_LUA` with batch unpacked `ZADD` for costs > 1, preventing Redis event loop stalls.
- **Dual Backends**: Distributed Redis backend (atomic Lua script evaluation) and bounded in-memory LRU cache (`BoundedLruCache(10000)` with $O(1)$ memory ceiling).
- **IETF Draft-08 Headers**: Generates `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `RateLimit-Policy` (`<limit>;w=<windowSec>`), and `Retry-After` headers.
- **RFC 9457 Integration**: Emits `429 Too Many Requests` Problem Details envelopes upon limit breach.
- **AppSec Hardening**: Enforces strict positive integer validation on `cost` parameter, blocking negative-cost token-minting bypasses.
- **In-Memory Testing Double**: Provided `@shukoi/ratelimit/testing` featuring `MockRateLimitRedisClient`.
