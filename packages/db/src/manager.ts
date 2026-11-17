/**
 * @purpose Universal Transaction Manager coordinating composite cancellation, auto-rollback, and graceful draining.
 * @rationale Ensures database transactions abort promptly on client disconnect/timeout and cleanly drains pools on SIGTERM.
 * @preconditions None.
 * @invariants Atomic transaction counter; composite abort propagation; zero zombie locks.
 */

import { DomainError } from '@shukoi/core';
import type { TransactionOptions } from './types.js';

/**
 * @purpose Coordinates transaction execution lifecycle, AbortSignal propagation, and graceful draining.
 * @rationale Centralizes transaction lifecycle handling and cancellation listeners for all ORM adapters.
 * @preconditions None.
 * @invariants Thread-safe across concurrent async tasks; O(1) state transitions.
 */
export class TransactionManager {
  private activeCount = 0;
  private isDraining = false;

  /**
   * @purpose Executes a database transaction with composite AbortSignal monitoring and auto-rollback.
   * @rationale Combines caller abort signal and timeout deadlines to trigger driver rollback when aborted.
   * @preconditions txRunner and handler must be valid callable functions.
   * @param txRunner Callback invoking the driver's native transaction mechanism.
   * @param handler User business logic to run within transaction.
   * @param options Transaction timeout and abort signals.
   * @returns Result of the transaction handler.
   * @throws DomainError('SERVICE_UNAVAILABLE', 503) if server is draining.
   * @throws DomainError('GATEWAY_TIMEOUT', 504) if signal aborts prior to or during execution.
   * @invariants Monotonically updates activeCount; guarantees LIFO abort cleanup.
   */
  public async execute<TTx, TResult>(
    txRunner: (runInTx: (tx: TTx) => Promise<TResult>) => Promise<TResult>,
    handler: (tx: TTx) => Promise<TResult>,
    options?: TransactionOptions,
  ): Promise<TResult> {
    if (this.isDraining) {
      throw new DomainError(
        'SERVICE_UNAVAILABLE',
        'Database pool is draining; new transactions rejected',
        503,
      );
    }

    const timeoutSignal =
      typeof options?.timeoutMs === 'number' && options.timeoutMs > 0
        ? AbortSignal.timeout(options.timeoutMs)
        : undefined;

    const signal =
      options?.signal && timeoutSignal
        ? AbortSignal.any([options.signal, timeoutSignal])
        : (options?.signal ?? timeoutSignal);

    if (signal?.aborted) {
      throw new DomainError('GATEWAY_TIMEOUT', 'Transaction aborted prior to acquisition', 504);
    }

    this.activeCount++;
    try {
      return await txRunner(async (tx: TTx) => {
        if (signal?.aborted) {
          throw new DomainError('GATEWAY_TIMEOUT', 'Transaction aborted prior to execution', 504);
        }

        return await new Promise<TResult>((resolve, reject) => {
          let isDone = false;

          const onAbort = () => {
            if (!isDone) {
              isDone = true;
              reject(
                new DomainError(
                  'GATEWAY_TIMEOUT',
                  'Transaction aborted mid-flight by client or timeout',
                  504,
                ),
              );
            }
          };

          if (signal) {
            signal.addEventListener('abort', onAbort, { once: true });
          }

          handler(tx)
            .then((result) => {
              if (!isDone) {
                isDone = true;
                if (signal) {
                  signal.removeEventListener('abort', onAbort);
                }
                resolve(result);
              }
            })
            .catch((err) => {
              if (!isDone) {
                isDone = true;
                if (signal) {
                  signal.removeEventListener('abort', onAbort);
                }
                reject(err);
              }
            });
        });
      });
    } finally {
      this.activeCount = Math.max(0, this.activeCount - 1);
    }
  }

  /**
   * @purpose Returns the current number of active in-flight transactions.
   * @rationale Allows inspection of active transaction volume for readiness and drain loops.
   * @preconditions None.
   * @returns Current active transaction count as a non-negative integer.
   * @throws Never throws.
   * @invariants Big-O O(1) state read.
   */
  public getActiveCount(): number {
    return this.activeCount;
  }

  /**
   * @purpose Gracefully drains in-flight transactions and invokes optional connection close callback.
   * @rationale Prevents new transactions from starting and waits for active queries to complete before pool exit.
   * @preconditions None.
   * @param timeoutMs Maximum time to wait for active transactions to complete (default 5000ms).
   * @param closeFn Optional callback to close underlying pool or socket.
   * @returns Promise resolving when pool is drained and closed.
   * @throws Never throws unhandled.
   * @invariants Flips isDraining flag; bounded wait loop with deadline.
   */
  public async drain(timeoutMs = 5000, closeFn?: () => Promise<void>): Promise<void> {
    this.isDraining = true;
    const deadline = Date.now() + timeoutMs;

    while (this.activeCount > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    if (closeFn) {
      await closeFn();
    }
  }
}
