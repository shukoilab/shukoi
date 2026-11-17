/**
 * @purpose Transactional Outbox Pattern subsystem guaranteeing atomic dual-write consistency.
 * @rationale Ensures that domain state mutations and message queue publications are committed atomically in the same transaction.
 * @preconditions TransactionalOutboxStore implementation.
 * @invariants Guaranteed at-least-once message delivery; thread-safe worker batching.
 */

import type { EnqueueOutboxInput, OutboxEvent, TransactionalOutboxStore } from './types.js';

/**
 * @purpose Options for batch outbox dispatching worker loop.
 * @rationale Configures batch size, lock lease duration, and maximum retry attempts before event failure.
 * @preconditions None.
 * @invariants Readonly options structure.
 */
export interface DispatchBatchOptions {
  readonly batchSize?: number | undefined;
  readonly lockTtlMs?: number | undefined;
  readonly maxRetries?: number | undefined;
}

/**
 * @purpose Outbox coordinator providing event enqueuing and polling dispatching helpers.
 * @rationale Bridges domain transactions with asynchronous message publishing pipelines.
 * @preconditions Valid TransactionalOutboxStore instance.
 * @invariants Non-blocking queue polling; resilient error recording.
 */
export class TransactionalOutbox {
  private readonly store: TransactionalOutboxStore;

  /**
   * @purpose Initializes a new TransactionalOutbox instance.
   * @rationale Binds outbox storage engine.
   * @preconditions store must implement TransactionalOutboxStore.
   * @param store Backing outbox store.
   * @returns TransactionalOutbox instance.
   * @throws Never throws.
   * @invariants Big-O O(1).
   */
  public constructor(store: TransactionalOutboxStore) {
    this.store = store;
  }

  /**
   * @purpose Enqueues a new outbox event within the scope of an active database transaction.
   * @rationale Atomic insertion ensuring events persist only if the enclosing transaction commits.
   * @preconditions Active database transaction context.
   * @param tx Active driver transaction context.
   * @param input Outbox event data.
   * @returns Promise resolving to the materialized OutboxEvent record.
   * @throws Error if database insert fails.
   * @invariants Atomic write; Big-O O(1) database insertion.
   */
  public async enqueue(tx: unknown, input: EnqueueOutboxInput): Promise<OutboxEvent> {
    return await this.store.enqueue(tx, input);
  }

  /**
   * @purpose Polls and dispatches a batch of pending outbox events using row locking.
   * @rationale Claims unexpired events, publishes them to destination, and updates status or increments retry count.
   * @preconditions publisher must be a valid async callback function.
   * @param publisher Callback publishing the event to Kafka, RabbitMQ, SQS, or webhook.
   * @param options Batch size, lock lease, and maxRetries options.
   * @returns Promise resolving to count of successfully dispatched and failed events.
   * @throws Never throws unhandled; individual publish errors are caught and recorded.
   * @invariants At-least-once delivery semantics; row-level lock concurrency.
   */
  public async dispatchBatch(
    publisher: (event: OutboxEvent) => Promise<void>,
    options?: DispatchBatchOptions,
  ): Promise<{ dispatched: number; failed: number }> {
    const batchSize = options?.batchSize ?? 50;
    const lockTtlMs = options?.lockTtlMs ?? 30_000;
    const maxRetries = options?.maxRetries ?? 3;

    const events = await this.store.claimBatch(batchSize, lockTtlMs);
    let dispatched = 0;
    let failed = 0;

    for (const event of events) {
      try {
        await publisher(event);
        await this.store.markPublished(event.id);
        dispatched++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const nextRetry = event.retryCount + 1;
        if (nextRetry >= maxRetries) {
          await this.store.markFailed(event.id, errorMsg);
          failed++;
        } else if (this.store.markRetry) {
          await this.store.markRetry(event.id, errorMsg, nextRetry);
        } else {
          await this.store.markFailed(event.id, errorMsg);
          failed++;
        }
      }
    }

    return { dispatched, failed };
  }
}
