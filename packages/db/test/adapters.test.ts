/**
 * @purpose Unit test suite for @shukoi/db modular ORM adapters (Drizzle, Kysely, Prisma, D1).
 * @rationale Validates that 3rd-party ORM wrappers conform to the DatabaseAdapter contract with zero leaks.
 * @preconditions None.
 * @invariants Pure in-memory assertions; zero network side effects.
 */

import { describe, expect, it } from 'vitest';
import { createD1Adapter } from '../src/d1.js';
import { createDrizzleAdapter } from '../src/drizzle.js';
import { createKyselyAdapter } from '../src/kysely.js';
import { createPrismaAdapter } from '../src/prisma.js';

describe('@shukoi/db Modular ORM Adapters', () => {
  it('wraps Drizzle ORM transaction runner cleanly', async () => {
    let closed = false;
    const mockDrizzle = {
      transaction: async (cb: (tx: { drizzleTx: boolean }) => Promise<unknown>) => {
        return await cb({ drizzleTx: true });
      },
    };

    const adapter = createDrizzleAdapter(mockDrizzle, {
      system: 'postgresql',
      onClose: () => {
        closed = true;
      },
    });

    expect(adapter.system).toBe('postgresql');
    const result = await adapter.transaction(async (tx) => {
      expect(tx.drizzleTx).toBe(true);
      return { insertedId: '123' };
    });

    expect(result.insertedId).toBe('123');
    await adapter.close();
    expect(closed).toBe(true);
  });

  it('wraps Kysely Query Builder transaction runner cleanly', async () => {
    let destroyed = false;
    const mockKysely = {
      transaction: () => ({
        execute: async (cb: (trx: { kyselyTrx: boolean }) => Promise<unknown>) => {
          return await cb({ kyselyTrx: true });
        },
      }),
      destroy: async () => {
        destroyed = true;
      },
    };

    const adapter = createKyselyAdapter(mockKysely, { system: 'mysql' });
    expect(adapter.system).toBe('mysql');

    const result = await adapter.transaction(async (trx) => {
      expect(trx.kyselyTrx).toBe(true);
      return { rowsAffected: 1 };
    });

    expect(result.rowsAffected).toBe(1);
    await adapter.close();
    expect(destroyed).toBe(true);
  });

  it('wraps Prisma Client interactive transaction runner cleanly', async () => {
    let disconnected = false;
    const mockPrisma = {
      $transaction: async (cb: (tx: { prismaTx: boolean }) => Promise<unknown>) => {
        return await cb({ prismaTx: true });
      },
      $disconnect: async () => {
        disconnected = true;
      },
    };

    const adapter = createPrismaAdapter(mockPrisma, { system: 'postgresql' });
    expect(adapter.system).toBe('postgresql');

    const result = await adapter.transaction(async (tx) => {
      expect(tx.prismaTx).toBe(true);
      return { userCreated: true };
    });

    expect(result.userCreated).toBe(true);
    await adapter.close();
    expect(disconnected).toBe(true);
  });

  it('wraps Cloudflare D1 native SQLite adapter cleanly without node:* imports', async () => {
    const mockD1 = {
      prepare: (_query: string) => ({
        bind: (..._values: unknown[]) => ({}),
      }),
      batch: async <T = unknown>(statements: unknown[]): Promise<T[]> => {
        return statements as T[];
      },
    };

    const adapter = createD1Adapter(mockD1);
    expect(adapter.system).toBe('cloudflare_d1');

    const result = await adapter.transaction(async (d1) => {
      const batchResult = await d1.batch([{ sql: 'INSERT INTO users VALUES (1)' }]);
      return { count: batchResult.length };
    });

    expect(result.count).toBe(1);
    await adapter.close(); // No-op for D1
  });

  it('forwards isolationLevel to Drizzle, Kysely, and Prisma adapters', async () => {
    // 1. Drizzle with isolationLevel
    let drizzleIso = '';
    const mockDrizzle = {
      transaction: async (
        cb: (tx: unknown) => Promise<unknown>,
        config?: { isolationLevel?: string },
      ) => {
        drizzleIso = config?.isolationLevel ?? '';
        return await cb({});
      },
    };
    const drizzleAdapter = createDrizzleAdapter(mockDrizzle);
    await drizzleAdapter.transaction(async () => ({ ok: true }), {
      isolationLevel: 'serializable',
    });
    expect(drizzleIso).toBe('serializable');

    // 2. Kysely with isolationLevel
    let kyselyIso = '';
    const mockKysely = {
      transaction: () => ({
        setIsolationLevel(level: string) {
          kyselyIso = level;
          return this;
        },
        async execute(cb: (trx: unknown) => Promise<unknown>) {
          return await cb({});
        },
      }),
    };
    const kyselyAdapter = createKyselyAdapter(mockKysely);
    await kyselyAdapter.transaction(async () => ({ ok: true }), {
      isolationLevel: 'repeatable read',
    });
    expect(kyselyIso).toBe('repeatable read');

    // 3. Prisma with isolationLevel
    let prismaIso = '';
    const mockPrisma = {
      $transaction: async (
        cb: (tx: unknown) => Promise<unknown>,
        options?: { isolationLevel?: string },
      ) => {
        prismaIso = options?.isolationLevel ?? '';
        return await cb({});
      },
    };
    const prismaAdapter = createPrismaAdapter(mockPrisma);
    await prismaAdapter.transaction(async () => ({ ok: true }), {
      isolationLevel: 'read committed',
    });
    expect(prismaIso).toBe('read committed');
  });

  it('provides native batch() execution on D1 adapter', async () => {
    const mockD1 = {
      prepare: (_query: string) => ({ bind: () => ({}) }),
      batch: async <T = unknown>(_statements: unknown[]): Promise<T[]> => {
        return [{ success: true }, { success: true }] as T[];
      },
    };

    const adapter = createD1Adapter(mockD1);
    const batchRes = await adapter.batch([{ sql: 'STMT_1' }, { sql: 'STMT_2' }]);
    expect(batchRes.length).toBe(2);
  });
});
