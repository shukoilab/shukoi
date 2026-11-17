/**
 * @purpose Unified 8-step execution pipeline for invoking Shukoi actions across REST, MCP HTTP, and MCP STDIO transports.
 * @rationale Guarantees identical security, validation, cancellation, and cleanup semantics regardless of transport origin.
 * @preconditions action must be a CompiledAction; options must provide ShukoiConfig and transport identifier.
 * @invariants Deterministic execution sequence; composite cancellation via AbortSignal.any; LIFO finally cleanup hooks.
 */

import type { Static, TSchema } from '@sinclair/typebox';
import type { ActionExecutionContext, CompiledAction } from './action.js';
import { resolveAuth, type SingleFlightJwksClient } from './auth.js';
import type { ShukoiConfig } from './config.js';
import { DomainError } from './errors.js';
import type { IdempotencyStore } from './idempotency.js';
import { createShukoiLogger, type ShukoiLogger } from './logger.js';
import type { ShukoiPlugin } from './plugin.js';
import { cleanAndValidateOutput, sanitizeRawInput } from './validator.js';

/**
 * @purpose Universal transaction provider signature for database and Unit-of-Work integrations.
 * @rationale Encapsulates atomic isolation, rollback, and savepoints across arbitrary database ORMs.
 * @invariants Preserves caller timeout and abort signals.
 */
export type TransactionProvider<TServices = unknown> = (
  handler: (txServices: Readonly<TServices>) => Promise<unknown>,
  options?: { readonly timeoutMs?: number | undefined; readonly signal?: AbortSignal | undefined },
) => Promise<unknown>;

/**
 * @purpose Options parameterizing an action execution invocation.
 * @rationale Injects transport context, incoming headers, external signals, and dependency services into the pipeline.
 * @invariants Readonly options structure.
 */
export interface ExecuteActionOptions<TPlatform = unknown, TServices = unknown> {
  readonly config: ShukoiConfig;
  readonly transport: 'rest' | 'mcp-http' | 'mcp-stdio' | 'test';
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly platform?: TPlatform | undefined;
  readonly services?: TServices | undefined;
  readonly idempotencyStore?: IdempotencyStore | undefined;
  readonly jwksClient?: SingleFlightJwksClient | undefined;
  readonly staticApiKeys?: Readonly<Record<string, unknown>> | undefined;
  readonly progressReporter?:
    | ((progress: number, total?: number, message?: string) => Promise<void>)
    | undefined;
  readonly plugins?: readonly ShukoiPlugin[] | undefined;
  readonly transactionProvider?: TransactionProvider<TServices> | undefined;
}

/**
 * @purpose Executes a compiled action through the standardized 8-step Shukoi pipeline.
 * @rationale Enforces correlation tracking, composite cancellation, auth & scope verification, idempotency locks, input/output contracts, and guaranteed LIFO resource teardown.
 * @preconditions action must be valid CompiledAction instance; options must provide runtime configuration.
 * @param action Compiled action containing schema validators and handler logic.
 * @param rawInput Unvalidated input value from HTTP body, query params, or JSON-RPC arguments.
 * @param options Transport-level parameters and dependencies.
 * @returns Promise resolving to cleaned and validated action output.
 * @throws DomainError on validation failure, authentication failure, permission denial, conflict, or internal contract breaches.
 * @invariants Big-O time complexity bounded by handler logic; space complexity O(1) framework overhead; guaranteed LIFO cleanup.
 */
export async function executeAction<
  TInput extends TSchema,
  TOutput extends TSchema,
  TUser = unknown,
  TPlatform = unknown,
  TServices = unknown,
>(
  action: CompiledAction<TInput, TOutput, TUser, TPlatform, TServices>,
  rawInput: unknown,
  options: ExecuteActionOptions<TPlatform, TServices>,
): Promise<Static<TOutput>> {
  const { config, transport } = options;
  const headers = options.headers ?? {};

  // Step 1: Correlation ID & Child Logger Setup
  const headerName = config.observability.correlationIdHeader.toLowerCase();
  const rawCorrelationId = headers[headerName] ?? headers[config.observability.correlationIdHeader];
  const isValidCorrelationId =
    typeof rawCorrelationId === 'string' && /^[a-zA-Z0-9-_]{1,128}$/.test(rawCorrelationId);
  const requestId = isValidCorrelationId ? rawCorrelationId : crypto.randomUUID();

  const logger: ShukoiLogger = createShukoiLogger(config.observability, {
    requestId,
    action: action.name,
    transport,
  });

  // Step 2: Composite Cancellation Controller
  const effectiveTimeoutMs = action.timeoutMs ?? config.limits.defaultTimeoutMs;
  const timeoutSignal = AbortSignal.timeout(effectiveTimeoutMs);
  const combinedSignal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;

  // Step 3: Authentication & RBAC Scope Verification
  let authResult: { user: Readonly<TUser> | null; scopes: ReadonlySet<string> };
  try {
    authResult = await resolveAuth<TUser>(
      headers,
      config.security,
      options.jwksClient,
      options.staticApiKeys as Readonly<Record<string, TUser>> | undefined,
    );
  } catch (authErr) {
    if (action.authRequired) {
      throw authErr;
    }
    // If auth is not required by action, unverified/custom token falls back to anonymous user
    authResult = { user: null, scopes: Object.freeze(new Set<string>()) };
  }

  if (action.authRequired && authResult.user === null) {
    throw new DomainError('UNAUTHORIZED', `Action "${action.name}" requires authentication`, 401);
  }

  if (action.requiredScopes && action.requiredScopes.length > 0) {
    const hasWildcard = authResult.scopes.has('*');
    if (!hasWildcard) {
      for (const scope of action.requiredScopes) {
        if (!authResult.scopes.has(scope)) {
          throw new DomainError('FORBIDDEN', `Missing required permission scope: "${scope}"`, 403);
        }
      }
    }
  }

  // Step 4: Atomic Idempotency Lock
  let idempotencyKey: string | null = null;
  let lockAcquired = false;
  let lockCompleted = false;

  const idempotencyHeader = (action.http?.idempotencyHeaderName ?? 'idempotency-key').toLowerCase();
  const rawIdempKey = headers[idempotencyHeader] ?? headers['idempotency-key'];
  if (typeof rawIdempKey === 'string' && rawIdempKey.trim().length > 0) {
    idempotencyKey = rawIdempKey.trim();
  }

  if (action.http?.requireIdempotencyKey && idempotencyKey && options.idempotencyStore) {
    const lockResult = await options.idempotencyStore.tryAcquire(
      action.name,
      idempotencyKey,
      86400000,
    );
    if (!lockResult.acquired && lockResult.record?.status === 'COMPLETED') {
      // Return cached idempotency response
      return lockResult.record.responsePayload as Static<TOutput>;
    }
    lockAcquired = lockResult.acquired;
  }

  // Step 5: Input Sanitization, Depth Check & Validation
  const sanitizedInput = sanitizeRawInput(rawInput, config.limits.maxJsonDepth);
  if (!action.compiledInput.check(sanitizedInput)) {
    const errors = action.compiledInput.errors(sanitizedInput);
    const detail = errors.map((e) => `${e.path}: ${e.message}`).join(', ');
    throw new DomainError('VALIDATION_ERROR', `Input validation failed: ${detail}`, 422, errors);
  }

  // Step 6: Handler Invocation & Cleanup Hooks Collection
  const cleanupHooks: Array<() => Promise<void> | void> = [];

  const ctx: ActionExecutionContext<TUser, TPlatform, TServices> = Object.freeze({
    requestId,
    transport,
    signal: combinedSignal,
    user: authResult.user,
    scopes: authResult.scopes,
    idempotencyKey,
    headers: Object.freeze({ ...headers }),
    platform: (options.platform ?? {}) as Readonly<TPlatform>,
    services: (options.services ?? {}) as TServices,
    logger,
    async reportProgress(progress: number, total?: number, message?: string): Promise<void> {
      if (options.progressReporter) {
        await options.progressReporter(progress, total, message);
      }
    },
    onFinally(cleanupFn: () => Promise<void> | void): void {
      cleanupHooks.push(cleanupFn);
    },
    async transaction<TResult>(
      handler: (txServices: Readonly<TServices>) => Promise<TResult>,
      txOptions?: { readonly timeoutMs?: number | undefined },
    ): Promise<TResult> {
      if (combinedSignal.aborted) {
        throw new DomainError('GATEWAY_TIMEOUT', 'Transaction aborted prior to start', 504);
      }
      const timeoutMs = txOptions?.timeoutMs ?? effectiveTimeoutMs;
      const txSignal = AbortSignal.timeout(timeoutMs);
      const compositeTxSignal = AbortSignal.any([combinedSignal, txSignal]);

      if (options.transactionProvider) {
        return (await options.transactionProvider(
          handler as (txServices: Readonly<TServices>) => Promise<unknown>,
          {
            timeoutMs,
            signal: compositeTxSignal,
          },
        )) as TResult;
      }

      const svc = options.services;
      if (
        typeof svc === 'object' &&
        svc !== null &&
        'transaction' in svc &&
        typeof (svc as { transaction: unknown }).transaction === 'function'
      ) {
        return await (svc as { transaction: (h: typeof handler) => Promise<TResult> }).transaction(
          handler,
        );
      }

      if (compositeTxSignal.aborted) {
        throw new DomainError('GATEWAY_TIMEOUT', 'Transaction timed out', 504);
      }
      return await handler(options.services as TServices);
    },
  });

  const genericAction = action as unknown as CompiledAction<
    TSchema,
    TSchema,
    unknown,
    unknown,
    unknown
  >;
  const genericCtx = ctx as unknown as ActionExecutionContext<unknown, unknown, unknown>;

  // Step 6a: Plugin Lifecycle onActionStart Hook
  if (options.plugins) {
    for (const plugin of options.plugins) {
      if (plugin.onActionStart) {
        try {
          await plugin.onActionStart(genericAction, genericCtx);
        } catch (pluginErr) {
          logger.warn('Plugin onActionStart threw error', {
            plugin: plugin.name,
            error: pluginErr instanceof Error ? pluginErr.message : String(pluginErr),
          });
        }
      }
    }
  }

  try {
    if (combinedSignal.aborted) {
      throw new DomainError(
        'GATEWAY_TIMEOUT',
        'Execution aborted prior to handler invocation',
        504,
      );
    }

    const rawResult = await action.handler(Object.freeze(sanitizedInput as Static<TInput>), ctx);

    // Step 7: Output Sanitization & Contract Validation
    const cleanedOutput = cleanAndValidateOutput(action.compiledOutput, rawResult);

    if (lockAcquired && idempotencyKey && options.idempotencyStore) {
      await options.idempotencyStore.complete(action.name, idempotencyKey, cleanedOutput, 86400000);
      lockCompleted = true;
    }

    // Step 7a: Plugin Lifecycle onActionSuccess Hook
    if (options.plugins) {
      for (const plugin of options.plugins) {
        if (plugin.onActionSuccess) {
          try {
            await plugin.onActionSuccess(genericAction, genericCtx, cleanedOutput);
          } catch (pluginErr) {
            logger.warn('Plugin onActionSuccess threw error', {
              plugin: plugin.name,
              error: pluginErr instanceof Error ? pluginErr.message : String(pluginErr),
            });
          }
        }
      }
    }

    return cleanedOutput;
  } catch (err) {
    if (lockAcquired && !lockCompleted && idempotencyKey && options.idempotencyStore) {
      // Release lock on unhandled failure so subsequent retries are not blocked
      await options.idempotencyStore.release(action.name, idempotencyKey).catch(() => {});
    }

    const typedError = err instanceof Error ? err : new Error(String(err));

    // Step 7b: Plugin Lifecycle onActionError Hook
    if (options.plugins) {
      for (const plugin of options.plugins) {
        if (plugin.onActionError) {
          try {
            await plugin.onActionError(genericAction, genericCtx, typedError);
          } catch (pluginErr) {
            logger.warn('Plugin onActionError threw error', {
              plugin: plugin.name,
              error: pluginErr instanceof Error ? pluginErr.message : String(pluginErr),
            });
          }
        }
      }
    }

    if (err instanceof DomainError) {
      throw err;
    }

    if (combinedSignal.aborted) {
      throw new DomainError(
        'GATEWAY_TIMEOUT',
        'Action execution timed out or was cancelled by client',
        504,
      );
    }

    const message = err instanceof Error ? err.message : String(err);
    logger.error('Unhandled action execution error', { error: message });
    throw new DomainError('INTERNAL_SERVER_ERROR', 'Internal server error occurred', 500);
  } finally {
    // Step 8: Deterministic LIFO Resource Teardown
    for (let i = cleanupHooks.length - 1; i >= 0; i--) {
      const hook = cleanupHooks[i];
      if (hook) {
        try {
          await hook();
        } catch (cleanupErr) {
          logger.error('Error executing onFinally cleanup hook', {
            error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
          });
        }
      }
    }

    // Step 8a: Plugin Lifecycle onActionTeardown Hook
    if (options.plugins) {
      for (const plugin of options.plugins) {
        if (plugin.onActionTeardown) {
          try {
            await plugin.onActionTeardown(genericAction, genericCtx);
          } catch (pluginErr) {
            logger.warn('Plugin onActionTeardown threw error', {
              plugin: plugin.name,
              error: pluginErr instanceof Error ? pluginErr.message : String(pluginErr),
            });
          }
        }
      }
    }
  }
}
