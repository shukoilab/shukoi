# @shukoi/store-redis Package Constitution

## Local Scope & Boundaries

`@shukoi/store-redis` implements the `@shukoi/core` `IdempotencyStore` interface backed by Redis for multi-instance distributed environments (Kubernetes, AWS Lambda, Cloudflare Workers).

### Invariants & Non-Negotiable Rules

1. **Atomic Lua State Machine:**
   - All state transitions (`acquireOrReplay`, `completeExecution`, `release`) MUST execute within single-tick atomic Redis Lua scripts (`ACQUIRE_LUA`, `COMPLETE_LUA`, `RELEASE_LUA`).
   - Never implement multi-step check-then-set logic outside atomic scripts to prevent Time-of-Check to Time-of-Use (TOCTOU) race conditions.
2. **Zero `node:*` Imports in `./edge`:**
   - The `./edge` subpath and `UpstashRedisClient` MUST contain ZERO `node:*` imports or native C++ addons.
   - All edge operations must use Web-standard `fetch` and Web Crypto (`crypto.subtle`).
3. **Mandatory Lock Expiration:**
   - Every lock created via `tryAcquire()` MUST declare an explicit PX TTL to guarantee that crashed workers or unhandled container failures do not leave permanent deadlocks.
4. **Universal 7-Tag Docstrings:**
   - Every interface, class, method, function, and exported constant must include all 7 native docstring tags (`@purpose`, `@rationale`, `@preconditions`, `@param`, `@returns`, `@throws`, `@invariants`).
