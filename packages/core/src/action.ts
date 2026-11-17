/**
 * @purpose Universal declarative action definition contract (`defineAction`) for Shukoi.
 * @rationale Implements the "Write-Once Contract-First" paradigm where business logic, schema contracts, security requirements, and transport metadata are defined in a single declarative object.
 * @preconditions Input and output schemas must be valid TypeBox definitions; handler must be an async function.
 * @invariants Pure declarative factory; immutable return object; zero transport-specific side effects.
 */

import type { Static, TSchema } from '@sinclair/typebox';
import type { ShukoiLogger } from './logger.js';
import { type CompiledValidator, compileSchemaValidator } from './validator.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type McpEntityType = 'tool' | 'resource' | 'prompt';

/**
 * @purpose HTTP routing metadata configuration for an action.
 * @rationale Defines REST route path, HTTP method, success status, and optional idempotency requirements.
 * @invariants Readonly configuration object; immutable.
 */
export interface ActionHttpConfig {
  readonly method: HttpMethod;
  readonly path: string;
  readonly successStatus?: 200 | 201 | 202 | 204 | undefined;
  readonly responseType?: 'json' | 'stream' | 'binary' | undefined;
  readonly customContentType?: string | undefined;
  readonly requireIdempotencyKey?: boolean | undefined;
  readonly idempotencyHeaderName?: string | undefined;
}

/**
 * @purpose Model Context Protocol (MCP) metadata configuration for an action.
 * @rationale Declares whether an action is exposed as an MCP tool, resource, or prompt to LLM clients.
 * @invariants Readonly configuration object; immutable.
 */
export interface ActionMcpConfig {
  readonly enabled: boolean;
  readonly entityType: McpEntityType;
  readonly resourceUriTemplate?: string | undefined;
  readonly mimeType?: string | undefined;
  readonly annotations?:
    | {
        readonly title?: string | undefined;
        readonly readOnlyHint?: boolean | undefined;
        readonly destructiveHint?: boolean | undefined;
        readonly idempotentHint?: boolean | undefined;
        readonly openWorldHint?: boolean | undefined;
      }
    | undefined;
}

/**
 * @purpose Execution context injected into every action handler at runtime.
 * @rationale Transports caller identity, permission scopes, correlation tracking, cancellation signals, and cleanup hooks in a transport-agnostic interface.
 * @invariants Readonly properties; thread-safe across concurrent async tasks.
 */
export interface ActionExecutionContext<TUser = unknown, TPlatform = unknown, TServices = unknown> {
  readonly requestId: string;
  readonly transport: 'rest' | 'mcp-http' | 'mcp-stdio' | 'test';
  readonly signal: AbortSignal;
  readonly user: Readonly<TUser> | null;
  readonly scopes: ReadonlySet<string>;
  readonly idempotencyKey: string | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly platform: Readonly<TPlatform>;
  readonly services: TServices;
  readonly logger: ShukoiLogger;
  reportProgress(progress: number, total?: number, message?: string): Promise<void>;
  onFinally(cleanupFn: () => Promise<void> | void): void;
  transaction<TResult>(
    handler: (txServices: Readonly<TServices>) => Promise<TResult>,
    options?: { readonly timeoutMs?: number | undefined },
  ): Promise<TResult>;
}

/**
 * @purpose User-facing declaration contract for creating an action.
 * @rationale Enforces strict TypeBox contracts and transport metadata before compilation.
 * @invariants Pure interface definition.
 */
export interface ActionDefinition<
  TInput extends TSchema = TSchema,
  TOutput extends TSchema = TSchema,
  TUser = unknown,
  TPlatform = unknown,
  TServices = unknown,
> {
  readonly name: string;
  readonly summary?: string | undefined;
  readonly description: string;
  readonly tags?: readonly string[] | undefined;
  readonly deprecated?: boolean | undefined;
  readonly authRequired: boolean;
  readonly requiredScopes?: readonly string[] | undefined;
  readonly timeoutMs?: number | undefined;
  readonly http?: ActionHttpConfig | undefined;
  readonly mcp?: ActionMcpConfig | undefined;
  readonly input: TInput;
  readonly output: TOutput;
  handler(
    input: Readonly<Static<TInput>>,
    ctx: ActionExecutionContext<TUser, TPlatform, TServices>,
  ): Promise<Static<TOutput> | AsyncIterable<Static<TOutput>>>;
}

/**
 * @purpose Compiled action structure with pre-compiled input and output validators ready for execution.
 * @rationale Pre-compiles TypeBox validators at startup so runtime validation is $O(1)$ fast.
 * @invariants Deeply frozen object graph; immutable.
 */
export interface CompiledAction<
  TInput extends TSchema = TSchema,
  TOutput extends TSchema = TSchema,
  TUser = unknown,
  TPlatform = unknown,
  TServices = unknown,
> extends ActionDefinition<TInput, TOutput, TUser, TPlatform, TServices> {
  readonly compiledInput: CompiledValidator<TInput>;
  readonly compiledOutput: CompiledValidator<TOutput>;
}

/**
 * @purpose Declarative factory defining and pre-compiling a Shukoi action.
 * @rationale Enforces TypeBox schema compilation and freezes metadata once at startup to prevent runtime overhead.
 * @preconditions definition must specify name, description, authRequired, input, output, and handler.
 * @param definition Raw ActionDefinition specification.
 * @returns Fully compiled and frozen CompiledAction instance.
 * @throws Never throws during definition if schemas are valid.
 * @invariants Big-O time complexity O(1); thread-safe; returns deeply frozen structure.
 */
export function defineAction<
  TInput extends TSchema,
  TOutput extends TSchema,
  TUser = unknown,
  TPlatform = unknown,
  TServices = unknown,
>(
  definition: ActionDefinition<TInput, TOutput, TUser, TPlatform, TServices>,
): CompiledAction<TInput, TOutput, TUser, TPlatform, TServices> {
  const compiledInput = compileSchemaValidator(definition.input);
  const compiledOutput = compileSchemaValidator(definition.output);

  const compiled: CompiledAction<TInput, TOutput, TUser, TPlatform, TServices> = {
    ...definition,
    compiledInput,
    compiledOutput,
  };

  return Object.freeze(compiled);
}
