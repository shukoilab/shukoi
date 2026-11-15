/**
 * @purpose Testing harness and utilities for Shukoi actions and transports.
 * @rationale Enables unit and integration testing of actions without spinning up full network servers.
 * @preconditions ShukoiConfig or action definition.
 * @invariants Pure in-memory harness; zero external dependencies.
 */

import type { Static, TSchema } from '@sinclair/typebox';
import type { CompiledAction } from '../action.js';
import { createDefaultConfig, type ShukoiConfig } from '../config.js';
import { type ExecuteActionOptions, executeAction } from '../executeAction.js';
import { InMemoryIdempotencyStore } from '../idempotency.js';

/**
 * @purpose Creates an isolated test execution environment for Shukoi actions.
 * @rationale Simplifies authoring test suites for business logic, error paths, and cancellation.
 * @param config Optional partial ShukoiConfig.
 * @returns Action test harness with execute helper.
 * @throws Never throws.
 * @invariants Big-O time complexity O(1); isolated in-memory stores.
 */
export function createActionTestHarness(configOverrides?: {
  readonly security?: Partial<ShukoiConfig['security']>;
  readonly limits?: Partial<ShukoiConfig['limits']>;
  readonly observability?: Partial<ShukoiConfig['observability']>;
}) {
  const config = createDefaultConfig(configOverrides);
  const idempotencyStore = new InMemoryIdempotencyStore(1000);

  return {
    config,
    idempotencyStore,
    async execute<
      TInput extends TSchema,
      TOutput extends TSchema,
      TUser = unknown,
      TPlatform = unknown,
      TServices = unknown,
    >(
      action: CompiledAction<TInput, TOutput, TUser, TPlatform, TServices>,
      rawInput: unknown,
      optionsOverrides?: Partial<ExecuteActionOptions<TPlatform, TServices>>,
    ): Promise<Static<TOutput>> {
      return executeAction(action, rawInput, {
        config,
        transport: 'test',
        idempotencyStore,
        ...optionsOverrides,
      });
    },
  };
}
