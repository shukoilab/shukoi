# @shukoi/db

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

- Initial release of `@shukoi/db`: Universal modular database and transaction engine for Shukoi applications.
- **Pluggable ORM Adapters**: Subpath adapters for Drizzle ORM (`./drizzle`), Kysely Query Builder (`./kysely`), Prisma Client (`./prisma`), and Cloudflare D1 (`./d1`).
- **ANSI SQL Isolation Levels**: Added `TransactionIsolationLevel` support forwarded to Drizzle (`{ isolationLevel }`), Kysely (`.setIsolationLevel()`), and Prisma interactive transactions.
- **Cloudflare D1 Batching**: Added native `D1DatabaseAdapter.batch()` for atomic multi-statement execution in Cloudflare Workers.
- **Composite Abort & Auto-Rollback**: Binds database transactions to `ctx.signal`, executing immediate rollback on client disconnect or timeout.
- **Transactional Outbox Pattern**: Guarantees atomic dual-write consistency between domain state mutations and event publishing.
- **Connection Pool Lifecycle**: Graceful connection drain state machine closing pools cleanly without leaking socket handles or zombie locks.
- **In-Memory Testing Harness**: Provided `@shukoi/db/testing` with `MockDatabaseAdapter` and `MockOutboxStore`.
