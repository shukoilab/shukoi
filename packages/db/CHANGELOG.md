# @shukoi/db

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
