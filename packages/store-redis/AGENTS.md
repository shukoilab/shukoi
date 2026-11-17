# @shukoi/store-redis Package Constitution

## Local Scope & Boundaries

`@shukoi/store-redis` implements the `@shukoi/core` `IdempotencyStore` interface backed by Redis for multi-instance distributed environments (Kubernetes, AWS Lambda, Cloudflare Workers).

### Invariants & Non-Negotiable Rules

1. **Atomic Lua State Machine:**
   - All state transitions (`tryAcquire`, `complete`, `release`, `extendLock`) MUST execute within single-tick atomic Redis Lua scripts (`ACQUIRE_LUA`, `COMPLETE_LUA`, `RELEASE_LUA`, `EXTEND_LUA`).
   - Lua scripts must handle non-JSON or corrupted payloads safely using `pcall(cjson.decode, current)`.
   - Never implement multi-step check-then-set logic outside atomic scripts to prevent Time-of-Check to Time-of-Use (TOCTOU) race conditions.
2. **Multi-Driver Normalization:**
   - The package provides `wrapRedisClient(client)` to seamlessly normalize `ioredis`, `node-redis` (v4/v5), and `@upstash/redis` into Shukoi's standard `RedisClient` contract.
3. **Pure Web Standards & Zero `node:*` Imports:**
   - The entire package (both `./node` and `./edge`) contains ZERO `node:*` imports.
   - All edge operations must use Web-standard `fetch` and Web Crypto.
4. **Mandatory Lock Expiration:**
   - Every lock created via `tryAcquire()` MUST declare an explicit PX TTL to guarantee that crashed workers or unhandled container failures do not leave permanent deadlocks.
5. **Universal 7-Tag Docstrings:**
   - Every interface, class, method, function, and exported constant must include all 7 native docstring tags (`@purpose`, `@rationale`, `@preconditions`, `@param`, `@returns`, `@throws`, `@invariants`).
