# @shukoi/store-redis

## 1.0.3

### Initial Release

- Initial release of `@shukoi/store-redis`: Distributed Redis idempotency lock store for Shukoi applications.
- **Atomic Lua Scripts**: Single-roundtrip atomic lock acquisition (`ACQUIRE_LUA`), completion (`COMPLETE_LUA`), and safe release (`RELEASE_LUA`).
- **Dual Runtime Support**: Exposed `./node` for standard TCP socket clients (`ioredis`, `node-redis`) and `./edge` for pure Web-standard fetch clients (`UpstashRedisClient`) with 0 `node:*` imports.
- **In-Memory Testing Double**: Provided `@shukoi/store-redis/testing` featuring `MockRedisClient` for deterministic, zero-network unit testing.
