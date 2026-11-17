# @shukoi/ratelimit

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
