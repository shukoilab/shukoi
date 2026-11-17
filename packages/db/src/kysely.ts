/**
 * @purpose Kysely Query Builder adapter for Shukoi's universal database layer.
 * @rationale Wraps Kysely transaction runner with composite cancellation signals, auto-rollback, and pool draining.
 * @preconditions Kysely instance with .transaction().execute() and .destroy() methods.
 * @invariants Pure TypeScript adapter; zero runtime overhead.
 */

import { TransactionManager } from './manager.js';
import type { DatabaseAdapter, DatabaseSystem, TransactionOptions } from './types.js';

/**
 * @purpose Configuration options for Kysely adapter.
 * @rationale Configures target relational dialect and graceful connection pool shutdown handler.
 * @preconditions None.
 * @invariants Readonly options structure.
 */
export interface KyselyAdapterOptions {
  readonly system?: DatabaseSystem | undefined;
  readonly onClose?: (() => Promise<void> | void) | undefined;
}

/**
 * @purpose Creates a DatabaseAdapter wrapping a Kysely database instance.
 * @rationale Bridges Kysely query builder transactions into Shukoi's action execution context with automatic cancellation rollback.
 * @preconditions db must be a valid Kysely client with transaction() and execute() methods.
 * @param db Kysely instance.
 * @param options Adapter configuration options.
 * @returns Fully configured DatabaseAdapter instance.
 * @throws Never throws during factory invocation.
 * @invariants Pure factory function; Big-O O(1) invocation overhead.
 */
export function createKyselyAdapter<
  TDb extends {
    transaction: () => {
      setIsolationLevel?: (level: string) => {
        execute: (cb: (trx: TTrx) => Promise<unknown>) => Promise<unknown>;
      };
      execute: (cb: (trx: TTrx) => Promise<unknown>) => Promise<unknown>;
    };
    destroy?: () => Promise<void>;
  },
  TTrx = unknown,
>(db: TDb, options?: KyselyAdapterOptions): DatabaseAdapter<TDb, TTrx> {
  const manager = new TransactionManager();
  const system: DatabaseSystem = options?.system ?? 'postgresql';

  async function handleClose(): Promise<void> {
    if (options?.onClose) {
      await options.onClose();
    } else if (typeof db.destroy === 'function') {
      await db.destroy();
    }
  }

  return {
    client: db,
    system,
    async transaction<TResult>(
      handler: (tx: TTrx) => Promise<TResult>,
      txOptions?: TransactionOptions,
    ): Promise<TResult> {
      return await manager.execute<TTrx, TResult>(
        async (runInTx) => {
          let builder = db.transaction();
          if (txOptions?.isolationLevel && typeof builder.setIsolationLevel === 'function') {
            builder = builder.setIsolationLevel(txOptions.isolationLevel);
          }
          return (await builder.execute(runInTx as (trx: TTrx) => Promise<unknown>)) as TResult;
        },
        handler,
        txOptions,
      );
    },
    async close(): Promise<void> {
      await handleClose();
    },
    async drain(timeoutMs = 5000): Promise<void> {
      await manager.drain(timeoutMs, handleClose);
    },
  };
}
