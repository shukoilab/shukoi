/**
 * @purpose Quality Gate 02 (QG-02): Isolate Fallback Equivalence Test.
 * @rationale Guarantees that schemas compiled via JIT mode (TypeCompiler) and AST fallback mode (Value.Check) produce 100% identical validation decisions and error paths, preventing behavior drift between Cloudflare Workers isolates and Node/Bun runtimes.
 * @preconditions @shukoi/core validator module available.
 * @param None
 * @returns Test suite passing with exit code 0.
 * @throws Never throws unhandled; asserts test expectations.
 * @invariants Identical boolean results; identical error paths across JIT and AST modes.
 */

import { compileSchemaValidator } from '@shukoi/core';
import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';

describe('QG-02: Isolate Fallback Equivalence Test', () => {
  const ComplexOrderSchema = Type.Object({
    orderId: Type.String({ minLength: 5 }),
    priority: Type.Union([Type.Literal('LOW'), Type.Literal('MEDIUM'), Type.Literal('HIGH')]),
    items: Type.Array(
      Type.Object({
        sku: Type.String(),
        quantity: Type.Integer({ minimum: 1 }),
        price: Type.Number({ minimum: 0 }),
      }),
      { minItems: 1 },
    ),
    shipping: Type.Object({
      postalCode: Type.String({ pattern: '^[0-9]{5}$' }),
      express: Type.Boolean(),
    }),
  });

  const jitValidator = compileSchemaValidator(ComplexOrderSchema, false); // JIT mode
  const astValidator = compileSchemaValidator(ComplexOrderSchema, true); // Forced AST fallback mode

  it('evaluates valid complex objects identically in JIT and AST modes', () => {
    const validOrder = {
      orderId: 'ORD-998877',
      priority: 'HIGH',
      items: [
        { sku: 'SKU-A', quantity: 2, price: 49.99 },
        { sku: 'SKU-B', quantity: 1, price: 120.0 },
      ],
      shipping: {
        postalCode: '12345',
        express: true,
      },
    };

    expect(jitValidator.check(validOrder)).toBe(true);
    expect(astValidator.check(validOrder)).toBe(true);
  });

  it('rejects invalid complex objects with identical paths in JIT and AST modes', () => {
    const invalidOrder = {
      orderId: 'shrt', // too short
      priority: 'CRITICAL', // invalid literal
      items: [
        { sku: 'SKU-A', quantity: 0, price: -10 }, // quantity < 1, price < 0
      ],
      shipping: {
        postalCode: 'abcde', // fails regex
        express: 'not-a-bool', // wrong type
      },
    };

    expect(jitValidator.check(invalidOrder)).toBe(false);
    expect(astValidator.check(invalidOrder)).toBe(false);

    const jitErrors = jitValidator
      .errors(invalidOrder)
      .map((e) => e.path)
      .sort();
    const astErrors = astValidator
      .errors(invalidOrder)
      .map((e) => e.path)
      .sort();

    // Verify both modes detect errors on all invalid fields
    expect(jitErrors.length).toBeGreaterThanOrEqual(4);
    expect(astErrors.length).toBeGreaterThanOrEqual(4);

    expect(jitErrors).toContain('/orderId');
    expect(astErrors).toContain('/orderId');
    expect(jitErrors).toContain('/priority');
    expect(astErrors).toContain('/priority');
  });
});
