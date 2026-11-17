# @shukoi/auth

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

- Initial release of `@shukoi/auth`: Enterprise multi-strategy authentication and declarative RBAC/ABAC authorization for Shukoi applications.
- **Multi-Strategy Resolver**: Composite resolver chaining JWKS, Hashed API Keys, Signed Session Cookies, and RFC 7662 OIDC Token Introspection in deterministic priority order.
- **$O(1)$ Pre-Hashed Static API Keys**: Pre-hashes static keys at initialization to provide constant-time authentication immune to loop-position timing attacks.
- **Bounded OIDC Token Cache**: Replaced unbounded memory structures with `BoundedLruCache(5000)` with TTL eviction, preventing OOM under heavy traffic.
- **Optimized JWKS Caching**: Caches instantiated `createLocalJWKSet` keystores during `cacheTtlMs`, eliminating per-verification JSON Web Key rebuilds.
- **UTF-8 Safe Basic Auth**: Enhanced RFC 7662 Basic authentication client credentials encoding for international and UTF-8 secrets.
- **Declarative RBAC & ABAC**: Action-level guards for required roles (`roles`), capability scopes (`permissions`), and dynamic tenant/ownership policies (`policy`), eliminating BOLA/IDOR vulnerabilities.
- **In-Memory Testing Harness**: Provided `@shukoi/auth/testing` with `MockSessionStore`, `MockApiKeyStore`, and test credential utilities.
