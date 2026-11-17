# @shukoi/store-redis

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

- Initial release of `@shukoi/store-redis`: Distributed Redis idempotency lock store for Shukoi applications.
- **Atomic Lua Scripts**: Single-roundtrip atomic lock acquisition (`ACQUIRE_LUA`), completion (`COMPLETE_LUA`), safe release (`RELEASE_LUA`), and heartbeat lock extension (`EXTEND_LUA`).
- **Resilient JSON Parsing**: Lua scripts use `pcall(cjson.decode, current)` to eliminate unhandled crashes on corrupt keys.
- **Multi-Driver Adapter**: Introduced `wrapRedisClient()` to normalize positional `ioredis` arguments and `node-redis` options objects into Shukoi's standard contract.
- **Lock Heartbeat**: Added `extendLock()` method on `RedisIdempotencyStore` for long-running workflows.
- **Dual Runtime Support**: Pure Web-standard `./edge` subpath (`UpstashRedisClient`) and `./node` entrypoint with zero `node:*` imports.
- **In-Memory Testing Double**: Provided `@shukoi/store-redis/testing` featuring `MockRedisClient` for deterministic, zero-network unit testing.
