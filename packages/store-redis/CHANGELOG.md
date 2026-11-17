# @shukoi/store-redis

## 1.0.3

### Initial Release & Hardening

- Initial release of `@shukoi/store-redis`: Distributed Redis idempotency lock store for Shukoi applications.
- **Atomic Lua Scripts**: Single-roundtrip atomic lock acquisition (`ACQUIRE_LUA`), completion (`COMPLETE_LUA`), safe release (`RELEASE_LUA`), and heartbeat lock extension (`EXTEND_LUA`).
- **Resilient JSON Parsing**: Lua scripts use `pcall(cjson.decode, current)` to eliminate unhandled crashes on corrupt keys.
- **Multi-Driver Adapter**: Introduced `wrapRedisClient()` to normalize positional `ioredis` arguments and `node-redis` options objects into Shukoi's standard contract.
- **Lock Heartbeat**: Added `extendLock()` method on `RedisIdempotencyStore` for long-running workflows.
- **Dual Runtime Support**: Pure Web-standard `./edge` subpath (`UpstashRedisClient`) and `./node` entrypoint with zero `node:*` imports.
- **In-Memory Testing Double**: Provided `@shukoi/store-redis/testing` featuring `MockRedisClient` for deterministic, zero-network unit testing.
