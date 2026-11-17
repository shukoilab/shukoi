/**
 * @purpose Core type definitions for universal database transactions and outbox patterns.
 * @rationale Establishes unified contracts for 3rd-party ORM adapters, pool draining, and ACID outbox delivery.
 * @preconditions None.
 * @invariants Pure TypeScript interfaces and types; zero runtime overhead.
 */

/**
 * @purpose Supported underlying database dialect systems.
 * @rationale Restricts dialect identifiers to known relational engines supported by Shukoi.
 * @preconditions None.
 * @invariants String literal union.
 */
export type DatabaseSystem = 'postgresql' | 'mysql' | 'sqlite' | 'cloudflare_d1';

/**
 * @purpose Options passed to database transaction invocations.
 * @rationale Configures per-transaction timeout deadlines and composite cancellation signals.
 * @preconditions None.
 * @invariants Readonly options structure.
 */
export interface TransactionOptions {
  readonly timeoutMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * @purpose Universal database adapter interface integrating with Shukoi action execution contexts.
 * @rationale Decouples action handlers from specific ORMs, enabling seamless ORM swapping and composite abort rollbacks.
 * @preconditions Valid database client instance.
 * @invariants Pure interface; thread-safe across concurrent async tasks; zero connection leaks.
 */
export interface DatabaseAdapter<TClient = unknown, TTx = unknown> {
  readonly client: TClient;
  readonly system: DatabaseSystem;
  transaction<TResult>(
    handler: (tx: TTx) => Promise<TResult>,
    options?: TransactionOptions,
  ): Promise<TResult>;
  close(): Promise<void>;
  drain(timeoutMs?: number): Promise<void>;
}

/**
 * @purpose Status of an event in the transactional outbox table.
 * @rationale Tracks lifecycle state transitions from creation to final publishing or quarantine.
 * @preconditions None.
 * @invariants String literal union.
 */
export type OutboxEventStatus = 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED';

/**
 * @purpose Materialized record of an event in the transactional outbox table.
 * @rationale Implements the Transactional Outbox pattern guaranteeing at-least-once message delivery.
 * @preconditions None.
 * @invariants Immutable data transfer record.
 */
export interface OutboxEvent {
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly status: OutboxEventStatus;
  readonly retryCount: number;
  readonly createdAt: Date;
  readonly lockedUntil?: Date | undefined;
  readonly publishedAt?: Date | undefined;
  readonly error?: string | undefined;
}

/**
 * @purpose New event payload enqueued within an active database transaction.
 * @rationale Encapsulates event metadata and JSON payload prior to database insertion.
 * @preconditions None.
 * @invariants Readonly input data structure.
 */
export interface EnqueueOutboxInput {
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly headers?: Readonly<Record<string, string>> | undefined;
}

/**
 * @purpose Storage abstraction for persisting and polling transactional outbox events.
 * @rationale Enables plugging SQL tables, ORM models, or in-memory stores into the outbox engine.
 * @preconditions Backing database table created with status and lock lease columns.
 * @invariants Asynchronous atomic state updates; thread-safe row claiming.
 */
export interface TransactionalOutboxStore {
  enqueue(tx: unknown, input: EnqueueOutboxInput): Promise<OutboxEvent>;
  claimBatch(limit: number, lockTtlMs: number): Promise<readonly OutboxEvent[]>;
  markPublished(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  markRetry?(id: string, error: string, nextRetryCount: number): Promise<void>;
}
