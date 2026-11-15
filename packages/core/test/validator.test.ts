/**
 * @purpose Unit tests for adaptive schema validator, prototype stripping, and output cleaner.
 * @rationale Validates isolate capability fallback, anti-prototype pollution defense, and output contract enforcement.
 * @preconditions Vitest test runner.
 * @invariants Assertions must pass with exit code 0.
 */

import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/errors.js';
import {
  cleanAndValidateOutput,
  compileSchemaValidator,
  SUPPORTS_JIT,
  sanitizeRawInput,
} from '../src/validator.js';

describe('Adaptive Validator & Sanitizer', () => {
  it('correctly detects JIT capability in the current environment', () => {
    expect(typeof SUPPORTS_JIT).toBe('boolean');
  });

  it('validates schemas in both JIT mode and AST fallback mode equivalently', () => {
    const UserSchema = Type.Object({
      id: Type.String(),
      age: Type.Integer({ minimum: 0 }),
    });

    const jitValidator = compileSchemaValidator(UserSchema, false);
    const astValidator = compileSchemaValidator(UserSchema, true);

    const validData = { id: 'usr-123', age: 25 };
    const invalidData = { id: 'usr-123', age: -5 };

    expect(jitValidator.check(validData)).toBe(true);
    expect(astValidator.check(validData)).toBe(true);

    expect(jitValidator.check(invalidData)).toBe(false);
    expect(astValidator.check(invalidData)).toBe(false);

    expect(jitValidator.errors(invalidData).length).toBeGreaterThan(0);
    expect(astValidator.errors(invalidData).length).toBeGreaterThan(0);
  });

  it('strips prototype pollution keys (__proto__, constructor, prototype) recursively', () => {
    const payload = JSON.parse(
      '{"title":"test","__proto__":{"polluted":true},"nested":{"constructor":{"admin":true},"value":42}}',
    );

    const sanitized = sanitizeRawInput(payload, 10) as Record<string, unknown>;
    expect(sanitized.title).toBe('test');
    // biome-ignore lint/suspicious/noProto: Testing anti-prototype pollution defense
    expect(sanitized.__proto__).toBeUndefined();
    expect((sanitized.nested as Record<string, unknown>).constructor).toBeUndefined();
    expect((sanitized.nested as Record<string, unknown>).value).toBe(42);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('throws DomainError PAYLOAD_TOO_LARGE when nesting depth is exceeded', () => {
    let deep: Record<string, unknown> = { val: 1 };
    for (let i = 0; i < 20; i++) {
      deep = { next: deep };
    }

    expect(() => sanitizeRawInput(deep, 5)).toThrow(DomainError);
    try {
      sanitizeRawInput(deep, 5);
    } catch (err) {
      expect((err as DomainError).code).toBe('PAYLOAD_TOO_LARGE');
      expect((err as DomainError).statusCode).toBe(400);
    }
  });

  it('strips unexposed internal fields from output via cleanAndValidateOutput', () => {
    const OutputSchema = Type.Object({
      id: Type.String(),
      username: Type.String(),
    });

    const compiled = compileSchemaValidator(OutputSchema);
    const rawResult = {
      id: 'usr-1',
      username: 'alice',
      password_hash: '$2b$12$unexposedPasswordHashValue',
      internal_score: 9999,
    };

    const cleaned = cleanAndValidateOutput(compiled, rawResult);
    expect(cleaned).toEqual({ id: 'usr-1', username: 'alice' });
    expect((cleaned as Record<string, unknown>).password_hash).toBeUndefined();
  });

  it('throws INTERNAL_SERVER_ERROR if output fails schema validation', () => {
    const OutputSchema = Type.Object({
      id: Type.String(),
      username: Type.String(),
    });

    const compiled = compileSchemaValidator(OutputSchema);
    const malformedResult = {
      id: 12345, // invalid type
    };

    expect(() => cleanAndValidateOutput(compiled, malformedResult)).toThrow(DomainError);
    try {
      cleanAndValidateOutput(compiled, malformedResult);
    } catch (err) {
      expect((err as DomainError).code).toBe('INTERNAL_SERVER_ERROR');
      expect((err as DomainError).statusCode).toBe(500);
    }
  });
});
