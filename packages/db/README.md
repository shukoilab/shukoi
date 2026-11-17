# @shukoi/db

> **Universal Modular Database & Transaction Engine with Pluggable 3rd-Party ORM Adapters for Shukoi.**

`@shukoi/db` provides a vendor-agnostic database transaction engine and transactional outbox for Shukoi applications. It enables developers to plug in their preferred ORM or query builder (Drizzle, Kysely, Prisma, or Cloudflare D1) while guaranteeing atomic transactions, composite cancellation rollbacks, and zero connection leaks.

---

## Features

- 🔌 **Pluggable ORM Adapters:** First-class adapters for Drizzle ORM (`./drizzle`), Kysely (`./kysely`), Prisma (`./prisma`), and Cloudflare D1 (`./d1`).
- 🛑 **Composite Cancellation & Auto-Rollback:** Automatically rolls back active database transactions when clients disconnect or timeouts trigger, freeing row locks instantly.
- 📬 **Transactional Outbox Engine:** Eliminates dual-write inconsistencies by writing domain state changes and outbox events in the same atomic transaction.
- 🌊 **Graceful Drain State Machine:** In long-running servers, gracefully drains in-flight queries upon `SIGTERM`/`SIGINT` before closing connection pools, preventing zombie connections.
- 🌐 **Zero `node:*` Imports in `./d1`:** Native Cloudflare D1 adapter runs cleanly in V8 Isolates with pure Web standards.
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

# Option B: Kysely Query Builder
pnpm add kysely pg

# Option C: Prisma Client
pnpm add @prisma/client
```

---

## Usage

### 1. Connecting Drizzle ORM to Shukoi

```typescript
import { createRestRouter } from '@shukoi/api';
import { createDrizzleAdapter } from '@shukoi/db/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { orderAction } from './actions/order.js';
import { config } from './config.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

export const dbAdapter = createDrizzleAdapter(db, {
  system: 'postgresql',
  onClose: () => pool.end(),
});

export const app = createRestRouter([orderAction], config, {
  transactionProvider: dbAdapter.transaction,
  services: { db: dbAdapter.client },
});
```

### 2. Using Transactions Inside Actions

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

      // Execute queries inside atomic transaction:
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

## License

MIT © [shukoilab](https://github.com/shukoilab)
