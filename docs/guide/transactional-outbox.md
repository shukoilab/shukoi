# Transactional Outbox Pattern

> **Guaranteed at-least-once message delivery and dual-write consistency across distributed microservices.**

In distributed architectures, writing to a database and publishing an event to a message broker (such as Apache Kafka, RabbitMQ, or AWS SQS) inside the same action handler frequently introduces dual-write inconsistencies. If the database commit succeeds but the network call to the message broker fails, the event is permanently lost.

The **Transactional Outbox Pattern** solves this problem by writing both the domain mutation and the event record into the same database within a single atomic ACID transaction. A background worker subsequently polls and dispatches pending events with at-least-once delivery guarantees.

---

## 1. Outbox Table Schema

Implement the outbox table in PostgreSQL, MySQL, SQLite, or Cloudflare D1:

```sql
CREATE TABLE shukoi_outbox_events (
  id VARCHAR(36) PRIMARY KEY,
  aggregate_type VARCHAR(64) NOT NULL,
  aggregate_id VARCHAR(128) NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  payload JSON NOT NULL,
  headers JSON,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  retry_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_until TIMESTAMP NULL,
  published_at TIMESTAMP NULL
);

CREATE INDEX idx_shukoi_outbox_poll 
ON shukoi_outbox_events (status, locked_until, created_at);
```

### Drizzle ORM Table Schema Definition

```typescript
import { index, integer, json, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

export const shukoiOutboxEvents = pgTable(
  'shukoi_outbox_events',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    aggregateType: varchar('aggregate_type', { length: 64 }).notNull(),
    aggregateId: varchar('aggregate_id', { length: 128 }).notNull(),
    eventType: varchar('event_type', { length: 128 }).notNull(),
    payload: json('payload').notNull(),
    headers: json('headers'),
    status: varchar('status', { length: 16 }).default('PENDING').notNull(),
    retryCount: integer('retry_count').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    lockedUntil: timestamp('locked_until'),
    publishedAt: timestamp('published_at'),
  },
  (table) => [
    index('idx_shukoi_outbox_poll').on(table.status, table.lockedUntil, table.createdAt),
  ],
);
```

### Kysely Database Interface Definition

```typescript
import type { ColumnType, Generated } from 'kysely';

export interface ShukoiOutboxTable {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: string; // JSON string
  headers: string | null;
  status: Generated<'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED'>;
  retry_count: Generated<number>;
  created_at: Generated<Date>;
  locked_until: ColumnType<Date | null, Date | null, Date | null>;
  published_at: ColumnType<Date | null, Date | null, Date | null>;
}
```

---

## 2. Enqueuing Events Atomically

Inside your action handler, enqueue the outbox event using the active database transaction:

```typescript
import { defineAction } from '@shukoi/core';
import { Type } from '@sinclair/typebox';

export const createOrderAction = defineAction({
  name: 'createOrder',
  description: 'Creates order and stores outbox event in one atomic transaction',
  authRequired: true,
  input: Type.Object({ orderId: Type.String(), totalCents: Type.Integer() }),
  output: Type.Object({ orderId: Type.String() }),
  async handler(input, ctx) {
    return await ctx.transaction(async (txServices) => {
      const { db, outbox } = txServices;

      // 1. Commit domain business mutation
      await db.insertOrder(input);

      // 2. Commit event into outbox table in the SAME transaction
      await outbox.enqueue(db, {
        aggregateType: 'ORDER',
        aggregateId: input.orderId,
        eventType: 'ORDER_CREATED',
        payload: { orderId: input.orderId, totalCents: input.totalCents },
      });

      return { orderId: input.orderId };
    });
  },
});
```

---

## 3. Dispatching Outbox Events with Row Locking

Run a background worker or cron loop that claims batches using `SELECT FOR UPDATE SKIP LOCKED` (or atomic status transitions):

```typescript
import { TransactionalOutbox } from '@shukoi/db';
import { outboxStore } from './db.js';

const outbox = new TransactionalOutbox(outboxStore);

// Background worker polling loop
async function processOutboxBatch() {
  const report = await outbox.dispatchBatch(async (event) => {
    // Publish to Kafka, RabbitMQ, or Webhook:
    await messageBroker.publish(event.eventType, event.payload, {
      headers: event.headers,
    });
  }, {
    batchSize: 50,
    lockTtlMs: 30_000, // 30s lock lease
  });

  console.log(`Dispatched ${report.dispatched} events, failed ${report.failed}`);
}
```
