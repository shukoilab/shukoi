# @shukoi/db Package Constitution

## Local Scope & Boundaries

`@shukoi/db` provides universal database transaction orchestration, modular 3rd-party ORM adapters (Drizzle, Kysely, Prisma, Cloudflare D1), and the Transactional Outbox pattern for Shukoi applications.

### Invariants & Non-Negotiable Rules

1. **Zero Connection Leaks (Mandatory Pool Drain):**
   - Every database adapter implementing `DatabaseAdapter` MUST provide explicit `close()` and `drain(timeoutMs)` lifecycle methods.
   - Long-running servers MUST hook `drain()` to process termination signals (`SIGTERM`/`SIGINT`) to ensure in-flight transactions commit or roll back before terminating pool sockets.
2. **Composite Abort & Auto-Rollback:**
   - Database transactions managed through `ctx.transaction()` MUST listen to the composite `AbortSignal`.
   - When a client disconnects or an action times out, the active database transaction MUST be aborted and rolled back immediately to release table and row locks.
3. **Pure Web-Standard Edge Isolation (`./d1`):**
   - The `./d1` subpath MUST contain ZERO `node:*` imports or native C++ addons to remain 100% compatible with Cloudflare Workers V8 Isolates.
4. **Universal 7-Tag Docstrings:**
   - Every interface, class, method, function, and exported constant must include all 7 native docstring tags (`@purpose`, `@rationale`, `@preconditions`, `@param`, `@returns`, `@throws`, `@invariants`).
