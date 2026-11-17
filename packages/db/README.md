# @shukoi/db

> **Universal Modular Database & Transaction Engine with Pluggable 3rd-Party ORM Adapters for Shukoi**

[![npm version](https://img.shields.io/npm/v/@shukoi/db.svg)](https://www.npmjs.com/package/@shukoi/db)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`@shukoi/db` provides a vendor-agnostic database transaction engine and transactional outbox for Shukoi applications. It enables developers to plug in their preferred ORM or query builder (Drizzle, Kysely, Prisma, or Cloudflare D1) while guaranteeing atomic transactions, ANSI isolation levels, composite cancellation rollbacks, and zero connection leaks.

---

## Key Features & Invariants

- 🔌 **Pluggable ORM Adapters:** First-class modular subpaths for Drizzle ORM (`./drizzle`), Kysely (`./kysely`), Prisma (`./prisma`), and Cloudflare D1 (`./d1`).
- 🔒 **Universal ANSI SQL Isolation Levels:** Passes `isolationLevel` ('read uncommitted', 'read committed', 'repeatable read', 'serializable', 'snapshot') through `TransactionOptions` to Drizzle, Kysely, and Prisma.
- ⚡ **Native Cloudflare D1 Atomic Batching:** Exposes `D1DatabaseAdapter.batch()` directly for atomic multi-statement execution in Cloudflare Workers V8 Isolates.
- 🛑 **Composite Cancellation & Auto-Rollback:** Automatically rolls back active database transactions when clients disconnect or timeouts trigger, freeing row locks instantly.
- 📬 **Transactional Outbox Engine:** Eliminates dual-write inconsistencies by persisting domain state changes and outbox events in the same atomic transaction.
- 🌊 **Graceful Drain State Machine:** In long-running servers, gracefully drains in-flight queries upon `SIGTERM`/`SIGINT` before closing connection pools, preventing zombie connections.
- 🌐 **Pure Web Standards in `./d1`:** Native Cloudflare D1 adapter runs cleanly in V8 Isolates with zero `node:*` imports.
- 🧪 **Deterministic In-Memory Double:** Includes `MockDatabaseAdapter` and `MockOutboxStore` in `@shukoi/db/testing` for ultra-fast unit testing.

---

## Installation

```bash
pnpm add @shukoi/db @shukoi/core
```

Install your chosen ORM or database driver:

```bash
# Option A: Drizzle ORM
pnpm add drizzle-orm pg
pnpm add -D @types/pg

# Option B: Kysely Query Builder
pnpm add kysely pg
pnpm add -D @types/pg

# Option C: Prisma Client
pnpm add @prisma/client
```

---

## Driver Setup & Adapter Configuration

### 1. Drizzle ORM Setup

```typescript
import { createDrizzleAdapter } from '@shukoi/db/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

export const dbAdapter = createDrizzleAdapter(db, {
  system: 'postgresql',
  onClose: () => pool.end(),
});
```

### 2. Kysely Setup

```typescript
import { createKyselyAdapter } from '@shukoi/db/kysely';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new pg.Pool({ connectionString: process.env.DATABASE_URL }),
  }),
});

export const dbAdapter = createKyselyAdapter(db, {
  system: 'postgresql',
  onClose: () => db.destroy(),
});
```

### 3. Prisma Client Setup

```typescript
import { createPrismaAdapter } from '@shukoi/db/prisma';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const dbAdapter = createPrismaAdapter(prisma, {
  system: 'postgresql',
  maxWaitMs: 5000,
  timeoutMs: 10000,
  onClose: () => prisma.$disconnect(),
});
```

### 4. Cloudflare D1 Setup

```typescript
import { createD1Adapter } from '@shukoi/db/d1';

export default {
  async fetch(request, env) {
    const dbAdapter = createD1Adapter(env.DB);
    // Use dbAdapter.batch() for atomic multi-statement mutations
  },
};
```

> **Cloudflare D1 Transaction Architecture Note:** Cloudflare D1 manages transactions automatically via `db.batch()`. Manual `BEGIN TRANSACTION` / `COMMIT` statements are rejected by D1. Multi-statement atomic mutations must use `dbAdapter.batch([stmt1, stmt2])` to guarantee all-or-nothing execution.

---

## Using Transactions Inside Actions

Action handlers interact with database transactions via `ctx.transaction()`:

```typescript
import { defineAction, DomainError } from '@shukoi/core';
import { Type } from '@sinclair/typebox';

export const createOrderAction = defineAction({
  name: 'createOrder',
  description: 'Creates order and reserves inventory atomically',
  authRequired: true,
  input: Type.Object({ itemId: Type.String(), quantity: Type.Integer({ minimum: 1 }) }),
  output: Type.Object({ orderId: Type.String(), status: Type.String() }),
  async handler(input, ctx) {
    return await ctx.transaction(async (txServices) => {
      const { db } = txServices;

      const order = await db.insertOrder(input);
      if (!order) {
        throw new DomainError('CONFLICT', 'Insufficient stock', 409);
      }

      return { orderId: order.id, status: 'RESERVED' };
    });
  },
});
```

---

## Transaction Isolation Levels

`TransactionOptions` supports ANSI SQL isolation levels:

```typescript
await dbAdapter.transaction(
  async (tx) => {
    // Queries execute under serializable isolation
  },
  {
    isolationLevel: 'serializable',
    timeoutMs: 5000,
  },
);
```

### Dialect Support Matrix

| Isolation Level      |     PostgreSQL      |        MySQL        |     SQLite / D1     |
| :------------------- | :-----------------: | :-----------------: | :-----------------: |
| `'read uncommitted'` |      Supported      |      Supported      |    Not Supported    |
| `'read committed'`   | Supported (Default) |      Supported      |    Not Supported    |
| `'repeatable read'`  |      Supported      | Supported (Default) |    Not Supported    |
| `'serializable'`     |      Supported      |      Supported      | Supported (Default) |
| `'snapshot'`         |      Supported      |    Not Supported    |    Not Supported    |

---

## Transactional Outbox Pattern

Eliminate dual-write inconsistencies between domain writes and event publishing:

```typescript
import { TransactionalOutbox } from '@shukoi/db';

const outbox = new TransactionalOutbox(outboxStore);

await dbAdapter.transaction(async (tx) => {
  // 1. Mutate domain state
  await tx.insert(orders).values(newOrder);

  // 2. Enqueue event in the same atomic transaction
  await outbox.enqueue(tx, {
    aggregateType: 'Order',
    aggregateId: newOrder.id,
    eventType: 'OrderCreated',
    payload: { orderId: newOrder.id, total: newOrder.total },
  });
});
```

---

## Testing Without a Database

Use `@shukoi/db/testing` for zero-network assertions in unit tests:

```typescript
import { MockDatabaseAdapter, MockOutboxStore } from '@shukoi/db/testing';

const mockDb = new MockDatabaseAdapter({ system: 'postgresql' });
const mockOutbox = new MockOutboxStore();

await mockDb.transaction(async (tx) => {
  // Run test actions
});

expect(mockDb.getCommitCount()).toBe(1);
expect(mockDb.getRollbackCount()).toBe(0);
```
