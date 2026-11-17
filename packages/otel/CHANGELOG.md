# @shukoi/otel

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

- Initial release of `@shukoi/otel`: Enterprise OpenTelemetry distributed tracing and Prometheus metrics plugin for Shukoi.
- **W3C TraceContext**: Parses and serializes standard `traceparent` headers across REST and MCP transports.
- **OTLP 1.34+ Compliance**: `OtlpHttpSpanExporter` now emits `service.name` and optional custom metadata inside `resource.attributes`.
- **Span Classification & Exception Logging**: Added `SpanKind` support and `span.recordException(error)` for standard OpenTelemetry exception events.
- **Prometheus Contiguity**: `serializeToPrometheusText` groups samples contiguously by metric family and safely escapes newlines in label values.
- **Span Lifecycle**: Automatic span instrumentation (`shukoi.action.${name}`) capturing action attributes, duration, error codes, and correlation IDs.
- **Dual Exporters**: Pure Web-standard OTLP/HTTP JSON exporter (`./edge`) and zero-dependency Prometheus text exposition exporter (`./prometheus`).
- **Resilience**: Bounded queue with $O(1)$ memory ceiling and drop-oldest backpressure eviction, preventing OOM.
- **In-Memory Testing Harness**: Provided `@shukoi/otel/testing` with `MockSpanExporter` and `MockMetricReader`.
