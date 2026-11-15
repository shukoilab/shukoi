/**
 * @purpose Isolate-safe adaptive validator and input/output sanitizer for Shukoi.
 * @rationale Automatically detects JIT runtime capabilities (Node.js, Bun) to execute fast compiled TypeBox validators, while falling back to AST validation on V8 edge isolates (Cloudflare Workers) where code generation is forbidden.
 * @preconditions Schemas must be valid TypeBox TSchema definitions; inputs must be pre-parsed JS values.
 * @invariants Strict schema isolation; additionalProperties: false enforced recursively; prototype pollution keys stripped.
 */

import type { Static, TSchema } from '@sinclair/typebox';
import { type TypeCheck, TypeCompiler } from '@sinclair/typebox/compiler';
import { Value } from '@sinclair/typebox/value';
import { DomainError } from './errors.js';

/**
 * @purpose Boot-time runtime capability probe detecting whether code generation via `new Function` is permitted.
 * @rationale Avoids unhandled EvalError crashes inside strict V8 sandboxes like Cloudflare Workers.
 * @invariants Evaluated once at module initialization; boolean constant.
 */
export const SUPPORTS_JIT: boolean = (() => {
  try {
    const fn = new Function('return true');
    return fn() === true;
  } catch {
    return false;
  }
})();

/**
 * @purpose Interface representing an adaptive compiled schema validator.
 * @rationale Provides a unified checking and error extraction interface regardless of underlying execution mode (JIT vs AST).
 * @invariants Readonly methods; thread-safe across concurrent calls.
 */
export interface CompiledValidator<T extends TSchema = TSchema> {
  readonly schema: T;
  check(data: unknown): data is Static<T>;
  errors(data: unknown): readonly { readonly path: string; readonly message: string }[];
}

/**
 * @purpose Recursively traverses a TypeBox schema and enforces `additionalProperties: false` on all Object schemas.
 * @rationale Prevents unintentional data injection and ensures strict contract boundaries.
 * @preconditions Valid TypeBox schema object.
 * @param schema Schema node to enforce strictness on.
 * @returns Mutated or cloned schema with additionalProperties: false.
 * @throws Never throws.
 * @invariants Big-O time complexity O(k) where k is total schema AST nodes.
 */
export function enforceStrictObjects<T extends TSchema>(schema: T): T {
  if (schema === null || typeof schema !== 'object') {
    return schema;
  }

  const s = schema as Record<string, unknown>;
  if (s['type'] === 'object' && s['additionalProperties'] === undefined) {
    s['additionalProperties'] = false;
  }

  if (s['properties'] && typeof s['properties'] === 'object') {
    const props = s['properties'] as Record<string, TSchema>;
    for (const key of Object.keys(props)) {
      const prop = props[key];
      if (prop !== undefined) {
        enforceStrictObjects(prop);
      }
    }
  }

  if (s['items'] && typeof s['items'] === 'object') {
    enforceStrictObjects(s['items'] as TSchema);
  }

  return schema;
}

/**
 * @purpose Compiles a TypeBox schema into an isolate-safe adaptive validator.
 * @rationale Uses TypeCompiler when JIT is available for sub-millisecond execution; falls back to AST Value.Check in isolates.
 * @preconditions schema must be a valid TypeBox TSchema.
 * @param schema Target TypeBox schema to compile.
 * @param forceAst Optional boolean flag to force AST mode (useful for testing isolate fallback equivalence).
 * @returns CompiledValidator instance providing check() and errors() functions.
 * @throws Never throws during compilation; invalid schemas throw inside TypeBox.
 * @invariants Thread-safe; pure validator output; zero mutation of evaluated data.
 */
export function compileSchemaValidator<T extends TSchema>(
  schema: T,
  forceAst = false,
): CompiledValidator<T> {
  const strictSchema = enforceStrictObjects(Value.Clone(schema));
  Object.freeze(strictSchema);

  if (SUPPORTS_JIT && !forceAst) {
    try {
      const compiled: TypeCheck<T> = TypeCompiler.Compile(strictSchema);
      return {
        schema: strictSchema,
        check: (data: unknown): data is Static<T> => compiled.Check(data),
        errors: (data: unknown): readonly { readonly path: string; readonly message: string }[] => {
          const errs = [...compiled.Errors(data)];
          return errs.map((e) => ({ path: e.path, message: e.message }));
        },
      };
    } catch {
      // In case compilation fails under unexpected runtime constraints, fall through to AST
    }
  }

  return {
    schema: strictSchema,
    check: (data: unknown): data is Static<T> => Value.Check(strictSchema, data),
    errors: (data: unknown): readonly { readonly path: string; readonly message: string }[] => {
      const errs = [...Value.Errors(strictSchema, data)];
      return errs.map((e) => ({ path: e.path, message: e.message }));
    },
  };
}

/**
 * @purpose Recursively sanitizes raw input objects to eliminate prototype pollution and enforce JSON nesting depth boundaries.
 * @rationale Mitigates CVE-class prototype pollution attacks (`__proto__`, `constructor`, `prototype`) and stack overflow / OOM DoS via deeply nested structures.
 * @preconditions data is an unvalidated JSON value; maxDepth is a positive integer.
 * @param data Target value to sanitize.
 * @param maxDepth Maximum permissible object/array recursion depth.
 * @param currentDepth Internal counter tracking current recursion level.
 * @returns Deeply sanitized clone of the input value with prototype keys removed.
 * @throws DomainError('PAYLOAD_TOO_LARGE', 'JSON nesting depth exceeded', 400) when depth boundary is breached.
 * @invariants Big-O time complexity O(n) where n is node count; space complexity O(d) call stack depth.
 */
export function sanitizeRawInput(data: unknown, maxDepth = 32, currentDepth = 0): unknown {
  if (currentDepth > maxDepth) {
    throw new DomainError(
      'PAYLOAD_TOO_LARGE',
      `JSON nesting depth exceeded maximum permissible limit of ${maxDepth}`,
      400,
    );
  }

  if (data === null || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    const sanitizedArray = new Array(data.length);
    for (let i = 0; i < data.length; i++) {
      sanitizedArray[i] = sanitizeRawInput(data[i], maxDepth, currentDepth + 1);
    }
    return sanitizedArray;
  }

  const sanitizedObj: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    // Strip prototype pollution attack vectors
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    sanitizedObj[key] = sanitizeRawInput(value, maxDepth, currentDepth + 1);
  }

  return sanitizedObj;
}

/**
 * @purpose Strips unexposed properties from handler return values and verifies output contract compliance.
 * @rationale Guarantees that internal database columns (e.g. password hashes, internal IDs) are never leaked to clients.
 * @preconditions compiledOutput must be a valid CompiledValidator; rawResult is handler output.
 * @param compiledOutput Compiled validator representing the expected action output schema.
 * @param rawResult Raw value returned by the action handler.
 * @returns Cleaned and validated result complying strictly with output schema.
 * @throws DomainError('INTERNAL_SERVER_ERROR', 'Output failed contract validation', 500) if required fields are missing or malformed.
 * @invariants Cleaned output has excess properties removed via Value.Clean; Big-O time complexity O(m).
 */
export function cleanAndValidateOutput<T extends TSchema>(
  compiledOutput: CompiledValidator<T>,
  rawResult: unknown,
): Static<T> {
  const cloned =
    typeof rawResult === 'object' && rawResult !== null ? Value.Clone(rawResult) : rawResult;
  const cleaned = Value.Clean(compiledOutput.schema, cloned);
  if (!compiledOutput.check(cleaned)) {
    const errors = compiledOutput.errors(cleaned);
    const detail = errors.map((e) => `${e.path}: ${e.message}`).join(', ');
    throw new DomainError(
      'INTERNAL_SERVER_ERROR',
      `Output failed contract validation: ${detail}`,
      500,
      errors,
    );
  }
  return cleaned as Static<T>;
}
