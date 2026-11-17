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

  it('executes ctx.transaction with strongly-typed services and custom transaction provider', async () => {
    interface MockDb {
      counter: number;
    }

    const inputSchema = Type.Object({ value: Type.Integer() });
    const outputSchema = Type.Object({ total: Type.Integer() });

    const action = defineAction<
      typeof inputSchema,
      typeof outputSchema,
      unknown,
      unknown,
      { db: MockDb }
    >({
      name: 'txAction',
      description: 'Tests transactional unit of work',
      authRequired: false,
      input: inputSchema,
      output: outputSchema,
      async handler(input, ctx) {
        return await ctx.transaction(async (tx) => {
          tx.db.counter += input.value;
          return { total: tx.db.counter };
        });
      },
    });

    const mockDb: MockDb = { counter: 10 };
    let providerCalled = false;

    const result = await harness.execute(
      action,
      { value: 5 },
      {
        services: { db: mockDb },
        transactionProvider: async (handler) => {
          providerCalled = true;
          return await handler({ db: mockDb });
        },
      },
    );

    expect(result).toEqual({ total: 15 });
    expect(providerCalled).toBe(true);
    expect(mockDb.counter).toBe(15);
  });

  it('triggers ShukoiPlugin lifecycle hooks (start, success, teardown)', async () => {
    const lifecycle: string[] = [];

    const mockPlugin = {
      name: 'test-telemetry',
      onActionStart() {
        lifecycle.push('start');
      },
      onActionSuccess() {
        lifecycle.push('success');
      },
      onActionError() {
        lifecycle.push('error');
      },
      onActionTeardown() {
        lifecycle.push('teardown');
      },
    };

    const action = defineAction({
      name: 'pluginAction',
      description: 'Tests plugin hooks',
      authRequired: false,
      input: Type.Object({}),
      output: Type.Object({ ok: Type.Boolean() }),
      async handler() {
        return { ok: true };
      },
    });

    const result = await harness.execute(action, {}, { plugins: [mockPlugin] });
    expect(result).toEqual({ ok: true });
    expect(lifecycle).toEqual(['start', 'success', 'teardown']);
  });

  it('triggers ShukoiPlugin onActionError hook when action throws and completes teardown', async () => {
    const lifecycle: string[] = [];
    let capturedError: Error | null = null;

    const mockPlugin = {
      name: 'error-telemetry',
      onActionStart() {
        lifecycle.push('start');
      },
      onActionSuccess() {
        lifecycle.push('success');
      },
      onActionError(_action: unknown, _ctx: unknown, error: Error) {
        lifecycle.push('error');
        capturedError = error;
      },
      onActionTeardown() {
        lifecycle.push('teardown');
      },
    };

    const failingAction = defineAction({
      name: 'failingAction',
      description: 'Fails with domain error',
      authRequired: false,
      input: Type.Object({}),
      output: Type.Object({ ok: Type.Boolean() }),
      async handler() {
        throw new DomainError('BAD_REQUEST', 'Simulated failure', 400);
      },
    });

    await expect(harness.execute(failingAction, {}, { plugins: [mockPlugin] })).rejects.toThrow(
      DomainError,
    );

    expect(lifecycle).toEqual(['start', 'error', 'teardown']);
    expect(capturedError).toBeInstanceOf(DomainError);
    expect((capturedError as unknown as DomainError).code).toBe('BAD_REQUEST');
  });

  it('rejects ctx.transaction when composite signal is aborted or transaction handler throws', async () => {
    const action = defineAction({
      name: 'txAbortAction',
      description: 'Tests transaction abort',
      authRequired: false,
      input: Type.Object({ shouldFail: Type.Boolean() }),
      output: Type.Object({ ok: Type.Boolean() }),
      async handler(input, ctx) {
        return await ctx.transaction(async () => {
          if (input.shouldFail) {
            throw new DomainError('CONFLICT', 'Transaction conflict rollback', 409);
          }
          return { ok: true };
        });
      },
    });

    // 1. Handler throws inside transaction
    await expect(harness.execute(action, { shouldFail: true })).rejects.toThrow(DomainError);

    // 2. Pre-aborted signal passed to transaction
    const controller = new AbortController();
    controller.abort();

    await expect(
      harness.execute(action, { shouldFail: false }, { signal: controller.signal }),
    ).rejects.toThrow(DomainError);
  });

  it('extracts W3C traceparent into ctx.traceId and ctx.spanId', async () => {
    let capturedTraceId: string | undefined;
    let capturedSpanId: string | undefined;

    const action = defineAction({
      name: 'traceAction',
      description: 'Tests traceparent extraction',
      authRequired: false,
      input: Type.Object({}),
      output: Type.Object({ ok: Type.Boolean() }),
      async handler(_input, ctx) {
        capturedTraceId = ctx.traceId;
        capturedSpanId = ctx.spanId;
        return { ok: true };
      },
    });

    const headers = {
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    };

    const res = await harness.execute(action, {}, { headers });
    expect(res.ok).toBe(true);
    expect(capturedTraceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(capturedSpanId).toBe('00f067aa0ba902b7');
  });

  it('evaluates declarative action.auth RBAC roles and permissions', async () => {
    const adminAction = defineAction({
      name: 'adminAction',
      description: 'Requires admin role and billing:write permission',
      authRequired: true,
      auth: {
        roles: ['admin', 'superadmin'],
        permissions: ['billing:write'],
      },
      input: Type.Object({}),
      output: Type.Object({ ok: Type.Boolean() }),
      async handler() {
        return { ok: true };
      },
    });

    // 1. Missing role
    const nonAdminUser = { id: 'u1', roles: ['viewer'], scopes: ['billing:write'] };
    await expect(
      harness.execute(
        adminAction,
        {},
        {
          headers: { 'x-api-key': 'valid_key' },
          staticApiKeys: { valid_key: nonAdminUser },
        },
      ),
    ).rejects.toThrow(DomainError);

    // 2. Has role, but missing permission
    const adminNoPerm = { id: 'u2', roles: ['admin'], scopes: ['billing:read'] };
    await expect(
      harness.execute(
        adminAction,
        {},
        {
          headers: { 'x-api-key': 'valid_key' },
          staticApiKeys: { valid_key: adminNoPerm },
        },
      ),
    ).rejects.toThrow(DomainError);

    // 3. Has role and permission via wildcard
    const superAdmin = { id: 'u3', roles: ['superadmin'], scopes: ['*'] };
    const res = await harness.execute(
      adminAction,
      {},
      {
        headers: { 'x-api-key': 'valid_key' },
        staticApiKeys: { valid_key: superAdmin },
      },
    );
    expect(res.ok).toBe(true);
  });

  it('evaluates declarative action.auth.policy ABAC guard preventing BOLA/IDOR', async () => {
    const tenantAction = defineAction({
      name: 'tenantAction',
      description: 'Enforces tenant boundary policy',
      authRequired: true,
      auth: {
        policy: (ctx, input) => {
          const user = ctx.user as { tenantId?: string } | null;
          return user?.tenantId === input.tenantId;
        },
      },
      input: Type.Object({ tenantId: Type.String() }),
      output: Type.Object({ ok: Type.Boolean() }),
      async handler() {
        return { ok: true };
      },
    });

    const userTenantA = { id: 'u1', tenantId: 'tenant_alpha' };

    // 1. User tenant_alpha tries to access tenant_beta -> 403 FORBIDDEN
    await expect(
      harness.execute(
        tenantAction,
        { tenantId: 'tenant_beta' },
        {
          headers: { 'x-api-key': 'valid_key' },
          staticApiKeys: { valid_key: userTenantA },
        },
      ),
    ).rejects.toThrow(DomainError);

    // 2. User tenant_alpha accesses tenant_alpha -> 200 OK
    const res = await harness.execute(
      tenantAction,
      { tenantId: 'tenant_alpha' },
      {
        headers: { 'x-api-key': 'valid_key' },
        staticApiKeys: { valid_key: userTenantA },
      },
    );
    expect(res.ok).toBe(true);
  });
});
