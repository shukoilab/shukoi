/**
 * @purpose Drizzle ORM adapter for Shukoi's universal database layer.
 * @rationale Wraps Drizzle transaction runner with composite cancellation signals, auto-rollback, and pool draining.
 * @preconditions Drizzle database instance with .transaction() method.
 * @invariants Pure TypeScript adapter; zero runtime overhead.
 */

import { TransactionManager } from './manager.js';
import type { DatabaseAdapter, DatabaseSystem, TransactionOptions } from './types.js';

/**
 * @purpose Configuration options for Drizzle ORM adapter.
 * @rationale Configures target relational dialect and graceful connection pool shutdown handler.
 * @preconditions None.
 * @invariants Readonly options structure.
 */
export interface DrizzleAdapterOptions {
  readonly system?: DatabaseSystem | undefined;
  readonly onClose?: (() => Promise<void> | void) | undefined;
}

/**
 * @purpose Creates a DatabaseAdapter wrapping a Drizzle ORM database instance.
 * @rationale Bridges Drizzle database transactions into Shukoi's action execution context with automatic cancellation rollback.
 * @preconditions db must be a valid Drizzle database client with a transaction() method.
 * @param db Drizzle database instance.
 * @param options Adapter configuration options.
 * @returns Fully configured DatabaseAdapter instance.
 * @throws Never throws during factory invocation.
 * @invariants Pure factory function; Big-O O(1) invocation overhead.
 */
export function createDrizzleAdapter<
  TDb extends {
    transaction: (
      cb: (tx: TTx) => Promise<unknown>,
      config?: { isolationLevel?: string },
    ) => Promise<unknown>;
  },
  TTx = unknown,
>(db: TDb, options?: DrizzleAdapterOptions): DatabaseAdapter<TDb, TTx> {
  const manager = new TransactionManager();
  const system: DatabaseSystem = options?.system ?? 'postgresql';

  return {
    client: db,
    system,
    async transaction<TResult>(
      handler: (tx: TTx) => Promise<TResult>,
      txOptions?: TransactionOptions,
    ): Promise<TResult> {
      return await manager.execute<TTx, TResult>(
        async (runInTx) => {
          const config = txOptions?.isolationLevel
            ? { isolationLevel: txOptions.isolationLevel }
            : undefined;
          return (await db.transaction(
            runInTx as (tx: TTx) => Promise<unknown>,
            config,
          )) as TResult;
        },
        handler,
        txOptions,
      );
    },
    async close(): Promise<void> {
      if (options?.onClose) {
        await options.onClose();
      }
    },
    async drain(timeoutMs = 5000): Promise<void> {
      await manager.drain(
        timeoutMs,
        options?.onClose ? async () => options.onClose?.() : undefined,
      );
    },
  };
}
