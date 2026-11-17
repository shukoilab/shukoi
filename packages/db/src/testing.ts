/**
 * @purpose In-memory test doubles and mock database adapters for unit testing.
 * @rationale Simulates ACID transactions, abort rollbacks, and outbox tables in memory without real database instances.
 * @preconditions None.
 * @invariants Pure in-memory state; thread-safe across concurrent test runners.
 */

import { TransactionManager } from './manager.js';
import type {
  DatabaseAdapter,
  EnqueueOutboxInput,
  OutboxEvent,
  TransactionalOutboxStore,
  TransactionOptions,
} from './types.js';

/**
 * @purpose In-memory database adapter double for testing actions and transaction handlers.
 * @rationale Simulates transaction commits, abort rollbacks, and pool draining in unit tests without external DBs.
 * @preconditions None.
 * @invariants Pure in-memory state; Big-O O(1) state transitions.
 */
export class MockDatabaseAdapter
  implements DatabaseAdapter<Record<string, unknown>, Record<string, unknown>>
{
  public readonly client: Record<string, unknown> = {};
  public readonly system = 'sqlite';
  public committedCount = 0;
  public rolledBackCount = 0;
  public isClosed = false;
  private readonly manager = new TransactionManager();

  /**
   * @purpose Executes a simulated in-memory database transaction.
   * @rationale Invokes handler with a transaction context, incrementing committedCount or rolledBackCount on outcome.
   * @preconditions handler must be a valid async callback function.
   * @param handler Transaction callback function.
   * @param options Transaction timeout and abort signals.
   * @returns Promise resolving to result of the handler.
   * @throws Error thrown by handler or DomainError on abort.
   * @invariants Big-O bounded by handler duration; thread-safe.
   */
  public async transaction<TResult>(
    handler: (tx: Record<string, unknown>) => Promise<TResult>,
    options?: TransactionOptions,
  ): Promise<TResult> {
    const txContext = { id: crypto.randomUUID(), inTx: true };

    return await this.manager.execute<Record<string, unknown>, TResult>(
      async (runInTx) => {
        try {
          const res = await runInTx(txContext);
          this.committedCount++;
          return res;
        } catch (err) {
          this.rolledBackCount++;
          throw err;
        }
      },
      handler,
      options,
    );
  }

  /**
   * @purpose Closes the simulated mock database connection.
   * @rationale Marks adapter as closed for teardown assertions.
   * @preconditions None.
   * @returns Promise resolving immediately.
   * @throws Never throws.
   * @invariants Big-O O(1).
   */
  public async close(): Promise<void> {
    this.isClosed = true;
  }

  /**
   * @purpose Drains in-flight transactions and marks adapter as closed.
   * @rationale Simulates graceful server shutdown in unit tests.
   * @preconditions None.
   * @param timeoutMs Drain timeout in milliseconds (default 5000ms).
   * @returns Promise resolving when active work is drained.
   * @throws Never throws.
   * @invariants Big-O O(1).
   */
  public async drain(timeoutMs = 5000): Promise<void> {
    await this.manager.drain(timeoutMs, async () => {
      this.isClosed = true;
    });
  }

  /**
   * @purpose Returns current active transaction count.
   * @rationale Allows inspecting in-flight transaction volume during tests.
   * @preconditions None.
   * @returns Active transaction count.
   * @throws Never throws.
   * @invariants Big-O O(1).
   */
  public getActiveCount(): number {
    return this.manager.getActiveCount();
  }
}

/**
 * @purpose In-memory implementation of TransactionalOutboxStore for testing outbox pipelines.
 * @rationale Simulates database outbox table operations including enqueuing, row-lock batch claiming, and retries.
 * @preconditions None.
 * @invariants Pure in-memory array operations; thread-safe across concurrent tests.
 */
export class MockOutboxStore implements TransactionalOutboxStore {
  private readonly events: OutboxEvent[] = [];

  /**
   * @purpose Enqueues a simulated outbox event.
   * @rationale Appends a new event with PENDING status to internal in-memory array.
   * @preconditions None.
   * @param _tx Simulated transaction context.
   * @param input Outbox event data.
   * @returns Promise resolving to created OutboxEvent record.
   * @throws Never throws.
   * @invariants Big-O O(1) array push.
   */
  public async enqueue(_tx: unknown, input: EnqueueOutboxInput): Promise<OutboxEvent> {
    const event: OutboxEvent = {
      id: crypto.randomUUID(),
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      payload: input.payload,
      headers: input.headers,
      status: 'PENDING',
      retryCount: 0,
      createdAt: new Date(),
    };
    this.events.push(event);
    return event;
  }

  /**
   * @purpose Claims a batch of unexpired outbox events simulating row-level locking.
   * @rationale Marks claimed events as PROCESSING with a lock lease timestamp.
   * @preconditions limit > 0 and lockTtlMs > 0.
   * @param limit Maximum number of events to claim.
   * @param lockTtlMs Lock lease duration in milliseconds.
   * @returns Promise resolving to array of claimed OutboxEvent records.
   * @throws Never throws.
   * @invariants Big-O O(N) array filter and update.
   */
  public async claimBatch(limit: number, lockTtlMs: number): Promise<readonly OutboxEvent[]> {
    const now = new Date();
    const claimable = this.events.filter(
      (e) =>
        e.status === 'PENDING' ||
        (e.status === 'PROCESSING' && e.lockedUntil && e.lockedUntil < now),
    );

    const claimed = claimable.slice(0, limit);
    for (const item of claimed) {
      const idx = this.events.findIndex((e) => e.id === item.id);
      const existing = this.events[idx];
      if (idx !== -1 && existing) {
        this.events[idx] = {
          ...existing,
          status: 'PROCESSING',
          lockedUntil: new Date(Date.now() + lockTtlMs),
        };
      }
    }

    return claimed;
  }

  /**
   * @purpose Marks an outbox event as PUBLISHED.
   * @rationale Updates event status and records publishedAt timestamp.
   * @preconditions Event with specified ID exists in store.
   * @param id Unique event identifier.
   * @returns Promise resolving when status is updated.
   * @throws Never throws.
   * @invariants Big-O O(N) array search.
   */
  public async markPublished(id: string): Promise<void> {
    const idx = this.events.findIndex((e) => e.id === id);
    const existing = this.events[idx];
    if (idx !== -1 && existing) {
      this.events[idx] = {
        ...existing,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      };
    }
  }

  /**
   * @purpose Marks an outbox event as FAILED after exhausting maxRetries.
   * @rationale Sets status to FAILED and records error message and incremented retryCount.
   * @preconditions Event with specified ID exists in store.
   * @param id Unique event identifier.
   * @param error Error description message.
   * @returns Promise resolving when status is updated.
   * @throws Never throws.
   * @invariants Big-O O(N) array search.
   */
  public async markFailed(id: string, error: string): Promise<void> {
    const idx = this.events.findIndex((e) => e.id === id);
    const existing = this.events[idx];
    if (idx !== -1 && existing) {
      this.events[idx] = {
        ...existing,
        status: 'FAILED',
        error,
        retryCount: existing.retryCount + 1,
      };
    }
  }

  /**
   * @purpose Updates an event for retry by releasing its lock and resetting status to PENDING.
   * @rationale Enables subsequent worker batch polls to retry transient errors without quarantining.
   * @preconditions Event with specified ID exists in store.
   * @param id Unique event identifier.
   * @param error Error message from the failed attempt.
   * @param nextRetryCount Incremented retry count.
   * @returns Promise resolving when retry state is persisted.
   * @throws Never throws.
   * @invariants Big-O O(N) array search.
   */
  public async markRetry(id: string, error: string, nextRetryCount: number): Promise<void> {
    const idx = this.events.findIndex((e) => e.id === id);
    const existing = this.events[idx];
    if (idx !== -1 && existing) {
      this.events[idx] = {
        ...existing,
        status: 'PENDING',
        lockedUntil: undefined,
        error,
        retryCount: nextRetryCount,
      };
    }
  }

  /**
   * @purpose Returns readonly snapshot of all in-memory events.
   * @rationale Enables assertions on outbox state transitions in unit tests.
   * @preconditions None.
   * @returns Readonly copy of events array.
   * @throws Never throws.
   * @invariants Big-O O(N) copy.
   */
  public getAllEvents(): readonly OutboxEvent[] {
    return [...this.events];
  }

  /**
   * @purpose Clears all stored events from memory.
   * @rationale Resets store between isolated test cases.
   * @preconditions None.
   * @returns void
   * @throws Never throws.
   * @invariants Big-O O(1) array truncation.
   */
  public clear(): void {
    this.events.length = 0;
  }
}
