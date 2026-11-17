# @shukoi/ratelimit Package Constitution

## Local Scope & Boundaries

`@shukoi/ratelimit` provides universal distributed and in-memory rate limiting (Sliding Window Counter and Token Bucket) for Shukoi REST APIs and Model Context Protocol (MCP) agents.

### Invariants & Non-Negotiable Rules

1. **Zero Memory Leaks ($O(1)$ Space Ceiling):**
   - In-memory rate limiting MUST use `BoundedLruCache` bounded by a strict maximum item cap (`maxMemoryEntries`, default 10,000).
   - Unbounded `Map` or `Set` instances are strictly prohibited.
2. **Strict Cost Input Sanitization:**
   - The `cost` parameter MUST be validated as a positive integer ($\ge 1$). Negative, zero, fractional, or `NaN` values MUST throw `DomainError('VALIDATION_ERROR', ..., 422)`.
3. **IETF Standards & RFC 9457 Compliance:**
   - Every rate limit evaluation MUST produce standard IETF Draft-08 headers: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `RateLimit-Policy`, and conditional `Retry-After`.
   - Breached limits MUST throw `DomainError('RATE_LIMIT_EXCEEDED', ..., 429)`.
4. **Single-Roundtrip Atomic Scripting:**
   - Distributed sliding window uses `SLIDING_WINDOW_LUA` with batch unpacked `ZADD` to prevent single-threaded Redis loop blocking.
   - Distributed token bucket uses `TOKEN_BUCKET_LUA` backed by Redis Hashes (`HMGET`/`HSET`) for atomic calculation.
5. **Zero `node:*` Imports:**
   - `@shukoi/ratelimit` must remain 100% web-standard compatible with zero `node:*` imports for Cloudflare Workers V8 Isolates.
6. **Universal 7-Tag Docstrings:**
   - Every interface, class, method, function, and exported constant must include all 7 native docstring tags (`@purpose`, `@rationale`, `@preconditions`, `@param`, `@returns`, `@throws`, `@invariants`).
