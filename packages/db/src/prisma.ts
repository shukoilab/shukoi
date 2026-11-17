/**
 * @purpose Prisma Client adapter for Shukoi's universal database layer.
 * @rationale Wraps Prisma interactive transaction runner with composite cancellation signals, auto-rollback, and pool draining.
 * @preconditions PrismaClient instance with .$transaction() and .$disconnect() methods.
 * @invariants Pure TypeScript adapter; zero runtime overhead.
 */

import { TransactionManager } from './manager.js';
import type { DatabaseAdapter, DatabaseSystem, TransactionOptions } from './types.js';

/**
 * @purpose Configuration options for Prisma Client adapter.
 * @rationale Configures target relational dialect, interactive transaction timeouts, and disconnect hooks.
 * @preconditions None.
 * @invariants Readonly options structure.
 */
export interface PrismaAdapterOptions {
  readonly system?: DatabaseSystem | undefined;
  readonly maxWaitMs?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly onClose?: (() => Promise<void> | void) | undefined;
}

/**
 * @purpose Creates a DatabaseAdapter wrapping a Prisma Client instance.
 * @rationale Bridges Prisma interactive transactions into Shukoi's action execution context with automatic cancellation rollback.
 * @preconditions prisma must be a valid PrismaClient instance with $transaction and $disconnect methods.
 * @param prisma PrismaClient instance.
 * @param options Adapter configuration options.
 * @returns Fully configured DatabaseAdapter instance.
 * @throws Never throws during factory invocation.
 * @invariants Pure factory function; Big-O O(1) invocation overhead.
 */
export function createPrismaAdapter<
  TPrisma extends {
    $transaction: (
      cb: (tx: TTx) => Promise<unknown>,
      options?: { maxWait?: number; timeout?: number },
    ) => Promise<unknown>;
    $disconnect?: () => Promise<void>;
  },
  TTx = unknown,
>(prisma: TPrisma, options?: PrismaAdapterOptions): DatabaseAdapter<TPrisma, TTx> {
  const manager = new TransactionManager();
  const system: DatabaseSystem = options?.system ?? 'postgresql';

  async function handleClose(): Promise<void> {
    if (options?.onClose) {
      await options.onClose();
    } else if (typeof prisma.$disconnect === 'function') {
      await prisma.$disconnect();
    }
  }

  return {
    client: prisma,
    system,
    async transaction<TResult>(
      handler: (tx: TTx) => Promise<TResult>,
      txOptions?: TransactionOptions,
    ): Promise<TResult> {
      return await manager.execute<TTx, TResult>(
        async (runInTx) => {
          const txConfig: { maxWait?: number; timeout?: number } = {};
          if (options?.maxWaitMs !== undefined) {
            txConfig.maxWait = options.maxWaitMs;
          }
          const effectiveTimeout = txOptions?.timeoutMs ?? options?.timeoutMs;
          if (effectiveTimeout !== undefined) {
            txConfig.timeout = effectiveTimeout;
          }
          return (await prisma.$transaction(
            runInTx as (tx: TTx) => Promise<unknown>,
            txConfig,
          )) as TResult;
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
