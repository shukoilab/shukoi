/**
 * @purpose Plugin lifecycle hooks interface and registry for @shukoi/core.
 * @rationale Enables modular, zero-dependency extension points for observability, tracing, auditing, and telemetry.
 * @preconditions None.
 * @invariants Pure interface and type definitions; Big-O O(1) invocation overhead.
 */

import type { TSchema } from '@sinclair/typebox';
import type { ActionExecutionContext, CompiledAction } from './action.js';

/**
 * @purpose Lifecycle hooks interface implemented by Shukoi plugins (e.g. OpenTelemetry, metrics, audit loggers).
 * @rationale Allows intercepting action execution phases without coupling business logic to external SDKs.
 * @invariants Non-blocking execution; hooks must handle their own internal errors gracefully.
 */
export interface ShukoiPlugin {
  readonly name: string;
  onActionStart?(
    action: CompiledAction<TSchema, TSchema, unknown, unknown, unknown>,
    ctx: ActionExecutionContext<unknown, unknown, unknown>,
  ): Promise<void> | void;
  onActionSuccess?(
    action: CompiledAction<TSchema, TSchema, unknown, unknown, unknown>,
    ctx: ActionExecutionContext<unknown, unknown, unknown>,
    result: unknown,
  ): Promise<void> | void;
  onActionError?(
    action: CompiledAction<TSchema, TSchema, unknown, unknown, unknown>,
    ctx: ActionExecutionContext<unknown, unknown, unknown>,
    error: Error,
  ): Promise<void> | void;
  onActionTeardown?(
    action: CompiledAction<TSchema, TSchema, unknown, unknown, unknown>,
    ctx: ActionExecutionContext<unknown, unknown, unknown>,
  ): Promise<void> | void;
}
