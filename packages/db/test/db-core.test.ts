/**
 * @purpose Unit test suite for @shukoi/db core transaction manager and outbox pattern.
 * @rationale Validates transaction lifecycle, composite abort rollbacks, pool draining, and outbox delivery.
 * @preconditions None.
 * @invariants Pure in-memory assertions; zero network side effects.
 */

import { DomainError } from '@shukoi/core';
import { describe, expect, it } from 'vitest';
import { TransactionManager } from '../src/manager.js';
import { TransactionalOutbox } from '../src/outbox.js';
import { MockDatabaseAdapter, MockOutboxStore } from '../src/testing.js';

describe('@shukoi/db Core & Transactional Outbox Suite', () => {
  describe('TransactionManager Lifecycle & Composite Abort', () => {
    it('commits successful transactions and tracks active counts', async () => {
      const adapter = new MockDatabaseAdapter();
      expect(adapter.getActiveCount()).toBe(0);

      const result = await adapter.transaction(async (tx) => {
        expect(tx.inTx).toBe(true);
        expect(adapter.getActiveCount()).toBe(1);
        return { success: true };
      });

      expect(result.success).toBe(true);
      expect(adapter.getActiveCount()).toBe(0);
      expect(adapter.committedCount).toBe(1);
      expect(adapter.rolledBackCount).toBe(0);
    });

    it('rolls back transaction when handler throws an error', async () => {
      const adapter = new MockDatabaseAdapter();

      await expect(
        adapter.transaction(async () => {
          throw new DomainError('CONFLICT', 'Unique key constraint failure', 409);
        }),
      ).rejects.toThrow(DomainError);

      expect(adapter.getActiveCount()).toBe(0);
      expect(adapter.committedCount).toBe(0);
      expect(adapter.rolledBackCount).toBe(1);
    });

    it('triggers immediate rollback when AbortSignal aborts mid-flight', async () => {
      const adapter = new MockDatabaseAdapter();
      const controller = new AbortController();

      const txPromise = adapter.transaction(
        async () => {
          // Simulate slow query
          await new Promise((r) => setTimeout(r, 200));
          return { done: true };
        },
        { signal: controller.signal },
      );

      // Abort after 30ms
      setTimeout(() => controller.abort(), 30);

      await expect(txPromise).rejects.toThrow(DomainError);
      expect(adapter.committedCount).toBe(0);
      expect(adapter.rolledBackCount).toBe(1);
    });

    it('aborts and rolls back when timeoutMs expires without explicit signal', async () => {
      const adapter = new MockDatabaseAdapter();

      const txPromise = adapter.transaction(
        async () => {
          await new Promise((r) => setTimeout(r, 100));
          return { done: true };
        },
        { timeoutMs: 30 },
      );

      await expect(txPromise).rejects.toThrow(DomainError);
      expect(adapter.committedCount).toBe(0);
      expect(adapter.rolledBackCount).toBe(1);
    });

    it('rejects new transactions and drains active work cleanly', async () => {
      const manager = new TransactionManager();
      let closed = false;

      // Start drain
      const drainPromise = manager.drain(500, async () => {
        closed = true;
      });

      // New transactions must be rejected with 503
      await expect(
        manager.execute(
          async (fn) => await fn({}),
          async () => ({ ok: true }),
        ),
      ).rejects.toThrow(DomainError);

      await drainPromise;
      expect(closed).toBe(true);
    });
  });

  describe('Transactional Outbox Pattern', () => {
    it('enqueues events atomically and dispatches them with status transitions', async () => {
      const store = new MockOutboxStore();
      const outbox = new TransactionalOutbox(store);

      // 1. Enqueue 3 events within simulated transactions
      await outbox.enqueue(
        {},
        {
          aggregateType: 'ORDER',
          aggregateId: 'ord_1',
          eventType: 'ORDER_CREATED',
          payload: { total: 100 },
        },
      );
      await outbox.enqueue(
        {},
        {
          aggregateType: 'ORDER',
          aggregateId: 'ord_2',
          eventType: 'ORDER_CREATED',
          payload: { total: 200 },
        },
      );
      await outbox.enqueue(
        {},
        {
          aggregateType: 'ORDER',
          aggregateId: 'ord_3',
          eventType: 'ORDER_FAILED',
          payload: { reason: 'card_declined' },
        },
      );

      expect(store.getAllEvents().length).toBe(3);

      // 2. Dispatch batch: 2 succeed, 1 fails
      const publishedEvents: string[] = [];
      const report = await outbox.dispatchBatch(
        async (event) => {
          if (event.aggregateId === 'ord_3') {
            throw new Error('Kafka broker unavailable');
          }
          publishedEvents.push(event.id);
        },
        { maxRetries: 1 },
      );

      expect(report.dispatched).toBe(2);
      expect(report.failed).toBe(1);
      expect(publishedEvents.length).toBe(2);

      const all = store.getAllEvents();
      expect(all.filter((e) => e.status === 'PUBLISHED').length).toBe(2);
      expect(all.filter((e) => e.status === 'FAILED').length).toBe(1);
    });

    it('retries failed events up to maxRetries before marking FAILED', async () => {
      const store = new MockOutboxStore();
      const outbox = new TransactionalOutbox(store);

      await outbox.enqueue(
        {},
        {
          aggregateType: 'ORDER',
          aggregateId: 'ord_retry',
          eventType: 'ORDER_CREATED',
          payload: { id: 1 },
        },
      );

      let attempts = 0;
      const failingPublisher = async () => {
        attempts++;
        throw new Error('Temporary network glitch');
      };

      // 1. First attempt fails (attempts=1, nextRetry=1 < maxRetries(3)) -> status remains PENDING
      const r1 = await outbox.dispatchBatch(failingPublisher, { maxRetries: 3 });
      expect(r1.dispatched).toBe(0);
      expect(r1.failed).toBe(0);
      expect(store.getAllEvents()[0]?.status).toBe('PENDING');
      expect(store.getAllEvents()[0]?.retryCount).toBe(1);

      // 2. Second attempt fails (attempts=2, nextRetry=2 < maxRetries(3)) -> status remains PENDING
      const r2 = await outbox.dispatchBatch(failingPublisher, { maxRetries: 3 });
      expect(r2.dispatched).toBe(0);
      expect(r2.failed).toBe(0);
      expect(store.getAllEvents()[0]?.status).toBe('PENDING');
      expect(store.getAllEvents()[0]?.retryCount).toBe(2);

      // 3. Third attempt fails (attempts=3, nextRetry=3 >= maxRetries(3)) -> status becomes FAILED
      const r3 = await outbox.dispatchBatch(failingPublisher, { maxRetries: 3 });
      expect(r3.dispatched).toBe(0);
      expect(r3.failed).toBe(1);
      expect(store.getAllEvents()[0]?.status).toBe('FAILED');
      expect(store.getAllEvents()[0]?.retryCount).toBe(3);
      expect(attempts).toBe(3);
    });
  });
});
