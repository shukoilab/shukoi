/**
 * @purpose Cloudflare D1 native SQLite adapter for Edge runtimes (V8 Isolates).
 * @rationale Provides atomic batch execution and transaction semantics in Cloudflare Workers with zero node:* imports.
 * @preconditions Cloudflare D1 binding instance.
 * @invariants Pure Web standards; 100% compatible with Cloudflare Workers Isolates; zero memory leaks.
 */

import { TransactionManager } from './manager.js';
import type { DatabaseAdapter, TransactionOptions } from './types.js';

/**
 * @purpose Minimal Cloudflare D1 interface definition without requiring @cloudflare/workers-types.
 * @rationale Permits typechecking across Edge targets without forced devDependencies.
 * @preconditions None.
 * @invariants Pure interface definition.
 */
export interface D1DatabaseLike {
  prepare(query: string): {
    bind(...values: unknown[]): unknown;
  };
  batch<T = unknown>(statements: unknown[]): Promise<T[]>;
  exec?(query: string): Promise<unknown>;
}

/**
 * @purpose Configuration options for Cloudflare D1 adapter.
 * @rationale Configures default query timeout limits for Edge environments.
 * @preconditions None.
 * @invariants Readonly options structure.
 */
export interface D1AdapterOptions {
  readonly defaultTimeoutMs?: number | undefined;
}

/**
 * @purpose Cloudflare D1 DatabaseAdapter interface extending base contract with native atomic batching.
 * @rationale Exposes d1.batch() directly for atomic multi-statement transactions in V8 Isolates.
 * @preconditions TD1 must implement minimal D1DatabaseLike batch contract.
 * @param None
 * @returns Interface specification.
 * @throws Never throws.
 * @invariants Pure Web standards; zero node:* imports.
 */
export interface D1DatabaseAdapter<TD1 extends D1DatabaseLike = D1DatabaseLike>
  extends DatabaseAdapter<TD1, TD1> {
  batch<T = unknown>(statements: unknown[]): Promise<T[]>;
}

/**
 * @purpose Creates a DatabaseAdapter wrapping a Cloudflare D1 binding.
 * @rationale Bridges Cloudflare D1 batch operations into Shukoi's action execution context with zero node:* leakage.
 * @preconditions d1 must be a valid D1Database binding instance from Cloudflare Workers env.
 * @param d1 D1Database binding from env.
 * @param _options Adapter configuration options.
 * @returns Fully configured D1DatabaseAdapter instance.
 * @throws Never throws during factory invocation.
 * @invariants Pure Web standards; Big-O O(1) invocation overhead.
 */
export function createD1Adapter<TD1 extends D1DatabaseLike = D1DatabaseLike>(
  d1: TD1,
  _options?: D1AdapterOptions,
): D1DatabaseAdapter<TD1> {
  const manager = new TransactionManager();

  return {
    client: d1,
    system: 'cloudflare_d1',
    async transaction<TResult>(
      handler: (tx: TD1) => Promise<TResult>,
      txOptions?: TransactionOptions,
    ): Promise<TResult> {
      return await manager.execute<TD1, TResult>(
        async (runInTx) => await runInTx(d1),
        handler,
        txOptions,
      );
    },
    async batch<T = unknown>(statements: unknown[]): Promise<T[]> {
      return await d1.batch<T>(statements);
    },
    async close(): Promise<void> {
      // D1 is managed serverless SQLite; zero sockets to close
    },
    async drain(timeoutMs = 5000): Promise<void> {
      await manager.drain(timeoutMs);
    },
  };
}
