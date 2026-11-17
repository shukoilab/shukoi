---
name: shukoi-database-transactions
description: Guides implementing universal database transactions, modular ORM adapters (Drizzle, Kysely, Prisma, D1), and the Transactional Outbox pattern in Shukoi applications. Use whenever actions mutate database state or require atomic dual-write event dispatch.
compatibility: TypeScript 5.5+, @shukoi/core, @shukoi/db
---

# Implementing Database Transactions & Outbox in Shukoi

## Core Invariants for AI Coding Agents

1. **Composite Abort Auto-Rollback:** Always pass `ctx.signal` to `ctx.transaction()`. Never suppress abort errors; allow the database driver to trigger an immediate `ROLLBACK` when clients disconnect or timeouts trigger.
2. **Transactional Outbox for Dual Writes:** When an action mutates database state and publishes events or webhooks, always write the event to the outbox table inside the same atomic transaction. Never publish to external brokers before the database commits.
3. **ANSI SQL Isolation Levels:** Specify `isolationLevel` ('read uncommitted', 'read committed', 'repeatable read', 'serializable', 'snapshot') in `TransactionOptions` when transactions require serializable or repeatable read consistency.
4. **Cloudflare D1 Multi-Statement Atomicity:** In Cloudflare D1, multi-statement atomic mutations MUST use `D1DatabaseAdapter.batch()`. Manual `BEGIN TRANSACTION` / `COMMIT` statements are rejected by Cloudflare D1.
5. **Pure Web-Standard Edge Isolation:** In Cloudflare Workers or V8 Isolates, use `@shukoi/db/d1`. Never import `node:*` modules or native socket drivers in Edge code paths.
6. **Mandatory Pool Lifecycle:** Long-running servers MUST register `dbAdapter.close()` or `dbAdapter.drain()` with the server graceful drain state machine (`server.onShutdown`) to prevent zombie connection handles on `SIGTERM`.

---

## 1. Setting Up Drizzle ORM Adapter

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

export const app = createRestRouter([orderAction], config);
```

---

## 2. Using Atomic Transactions & Outbox Inside Actions

```typescript
import { defineAction, DomainError } from '@shukoi/core';
import { Type } from '@sinclair/typebox';

export const createOrderAction = defineAction({
  name: 'createOrder',
  description: 'Creates order and stores outbox event in one atomic transaction',
  authRequired: true,
  input: Type.Object({ orderId: Type.String(), totalCents: Type.Integer({ minimum: 1 }) }),
  output: Type.Object({ orderId: Type.String(), status: Type.String() }),
  async handler(input, ctx) {
    return await ctx.transaction(async (txServices) => {
      const { db, outbox } = txServices;

      // 1. Commit domain business mutation
      const order = await db.insertOrder(input);
      if (!order) {
        throw new DomainError('CONFLICT', 'Order creation conflict', 409);
      }

      // 2. Commit event into outbox table in the SAME transaction
      await outbox.enqueue(db, {
        aggregateType: 'ORDER',
        aggregateId: input.orderId,
        eventType: 'ORDER_CREATED',
        payload: { orderId: input.orderId, totalCents: input.totalCents },
      });

      return { orderId: input.orderId, status: 'CREATED' };
    });
  },
});
```

---

## 3. Transaction Isolation Levels & Cloudflare D1 Batching

### Specifying Isolation Level
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

### Cloudflare D1 Atomic Batching
```typescript
import { createD1Adapter } from '@shukoi/db/d1';

const d1Adapter = createD1Adapter(env.DB);

// Atomically executes statements in a single D1 roundtrip
const results = await d1Adapter.batch([
  env.DB.prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?').bind(100, 'acc_1'),
  env.DB.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').bind(100, 'acc_2'),
]);
```
