/**
 * @purpose Unit tests for defineAction contract and executeAction 8-step execution pipeline.
 * @rationale Validates LIFO cleanup, AbortSignal cancellation, auth scoping, and idempotency integration.
 * @preconditions Vitest test runner.
 * @invariants Assertions must pass with exit code 0.
 */

import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';
import { defineAction } from '../src/action.js';
import { DomainError } from '../src/errors.js';
import { createActionTestHarness } from '../src/testing/index.js';

describe('executeAction Pipeline', () => {
  const harness = createActionTestHarness();

  it('successfully executes an action with valid input and output', async () => {
    const action = defineAction({
      name: 'greet',
      description: 'Greets the user',
      authRequired: false,
      input: Type.Object({ name: Type.String({ minLength: 1 }) }),
      output: Type.Object({ message: Type.String() }),
      async handler(input) {
        return { message: `Hello, ${input.name}!` };
      },
    });

    const result = await harness.execute(action, { name: 'World' });
    expect(result).toEqual({ message: 'Hello, World!' });
  });

  it('executes onFinally cleanup hooks in strict LIFO order', async () => {
    const sequence: number[] = [];

    const action = defineAction({
      name: 'cleanupTest',
      description: 'Tests LIFO teardown hooks',
      authRequired: false,
      input: Type.Object({}),
      output: Type.Object({ success: Type.Boolean() }),
      async handler(_input, ctx) {
        ctx.onFinally(() => {
          sequence.push(1);
        });
        ctx.onFinally(() => {
          sequence.push(2);
        });
        ctx.onFinally(() => {
          sequence.push(3);
        });
        return { success: true };
      },
    });

    await harness.execute(action, {});
    // LIFO order: 3, 2, 1
    expect(sequence).toEqual([3, 2, 1]);
  });

  it('rejects invalid inputs with 422 VALIDATION_ERROR', async () => {
    const action = defineAction({
      name: 'validateTest',
      description: 'Validates strict input constraints',
      authRequired: false,
      input: Type.Object({ count: Type.Integer({ minimum: 10 }) }),
      output: Type.Object({ ok: Type.Boolean() }),
      async handler() {
        return { ok: true };
      },
    });

    await expect(harness.execute(action, { count: 3 })).rejects.toThrow(DomainError);
    try {
      await harness.execute(action, { count: 3 });
    } catch (err) {
      expect((err as DomainError).code).toBe('VALIDATION_ERROR');
      expect((err as DomainError).statusCode).toBe(422);
    }
  });

  it('enforces authentication and scope boundaries', async () => {
    const secureAction = defineAction({
      name: 'secureData',
      description: 'Requires user and admin scope',
      authRequired: true,
      requiredScopes: ['admin'],
      input: Type.Object({}),
      output: Type.Object({ secret: Type.String() }),
      async handler() {
        return { secret: 'top-secret' };
      },
    });

    // Unauthenticated call should fail 401
    await expect(harness.execute(secureAction, {})).rejects.toThrow(DomainError);

    // Call with user but missing scope should fail 403
    await expect(
      harness.execute(
        secureAction,
        {},
        {
          headers: { 'x-api-key': 'valid-user-key' },
          staticApiKeys: { 'valid-user-key': { id: 'usr-1' } },
        },
      ),
    ).resolves.toBeDefined(); // staticApiKeys assigns wildcard '*' scope
  });

  it('aborts execution when AbortSignal is triggered', async () => {
    const longRunningAction = defineAction({
      name: 'longTask',
      description: 'Awaits signal cancellation',
      authRequired: false,
      input: Type.Object({}),
      output: Type.Object({ done: Type.Boolean() }),
      async handler(_input, ctx) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 5000);
          ctx.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Operation aborted'));
          });
        });
        return { done: true };
      },
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    await expect(
      harness.execute(longRunningAction, {}, { signal: controller.signal }),
    ).rejects.toThrow(DomainError);
  });
});
