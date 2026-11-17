# Database Transactions & Pluggable ORMs

> **Universal transaction orchestration and modular 3rd-party ORM adapters (Drizzle, Kysely, Prisma, D1) with composite cancellation rollbacks.**

Modern applications rely on diverse database technologies: Drizzle ORM for lightweight TypeScript inference, Kysely for type-safe complex SQL queries, Prisma Client for full-stack rapid development, or Cloudflare D1 for globally distributed edge serverless storage.

`@shukoi/db` provides a vendor-agnostic abstraction layer that integrates any 3rd-party ORM into Shukoi's action execution pipeline (`ctx.transaction`), ensuring atomic transactions, composite cancellation rollbacks, and clean connection pool lifecycles.

---

## 1. Supported ORM & Driver Adapters

| Adapter Subpath | ORM / Driver | Runtime Targets | Invariants |
| :--- | :--- | :--- | :--- |
| **`@shukoi/db/drizzle`** | Drizzle ORM | Node.js, Bun, Cloudflare Workers, AWS Lambda | Seamless `tx` inference; composite abort auto-rollback. |
| **`@shukoi/db/kysely`** | Kysely Query Builder | Node.js, Bun, AWS Lambda | Full dialect flexibility (Postgres, MySQL, SQLite); clean pool termination. |
| **`@shukoi/db/prisma`** | Prisma Client | Node.js, Bun, AWS Lambda | Interactive `$transaction` wrapper; configurable `maxWaitMs` and `timeoutMs`. |
| **`@shukoi/db/d1`** | Cloudflare D1 | Cloudflare Workers V8 Isolates | Pure Web standards with **zero `node:*` imports**; atomic batching. |
| **`@shukoi/db/testing`** | In-Memory Mock Double | Unit Tests, Local CI | Simulates commit, rollback, and outbox tables in memory without network I/O. |

---

## 2. Setting Up an Adapter

### Option A: Drizzle ORM (PostgreSQL)

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

### Option B: Cloudflare D1 Native Edge

```typescript
import { createRestRouter } from '@shukoi/api';
import { toCloudflareWorker } from '@shukoi/cloudflare';
import { createD1Adapter } from '@shukoi/db/d1';
import { orderAction } from './actions/order.js';
import { config } from './config.js';

export default toCloudflareWorker((env) => {
  const dbAdapter = createD1Adapter(env.DB);

  return createRestRouter([orderAction], config, {
    transactionProvider: dbAdapter.transaction,
    services: { db: dbAdapter.client },
  });
});
```

---

## 3. Using Transactions Inside Actions

Action handlers interact with the database via `ctx.transaction()`:

```typescript
import { defineAction, DomainError } from '@shukoi/core';
import { Type } from '@sinclair/typebox';

export const transferFundsAction = defineAction({
  name: 'transferFunds',
  description: 'Transfers funds between accounts within an atomic transaction',
  authRequired: true,
  input: Type.Object({
    fromAccountId: Type.String(),
    toAccountId: Type.String(),
    amountCents: Type.Integer({ minimum: 1 }),
  }),
  output: Type.Object({
    transactionId: Type.String(),
    status: Type.String(),
  }),
  async handler(input, ctx) {
    return await ctx.transaction(async (txServices) => {
      const { db } = txServices;

      // 1. Debit source account
      const debited = await db.debitAccount(input.fromAccountId, input.amountCents);
      if (!debited) {
        throw new DomainError('CONFLICT', 'Insufficient funds', 409);
      }

      // 2. Credit target account
      await db.creditAccount(input.toAccountId, input.amountCents);

      return {
        transactionId: crypto.randomUUID(),
        status: 'COMPLETED',
      };
    });
  },
});
```

---

## 4. Composite Cancellation & Auto-Rollback

If a client disconnects, a network timeout triggers, or a container deadline approaches (`ctx.signal.aborted` fires):
1. `ctx.transaction` immediately aborts execution.
2. The active transaction issues a `ROLLBACK` to the underlying database engine.
3. Row and table locks are released instantly, preventing orphaned or zombie locks.
4. The caller receives an RFC 9457 `504 Gateway Timeout` Problem Details response.
