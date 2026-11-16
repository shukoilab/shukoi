/**
 * @purpose Web-Standard in-memory testing mocks for Cloudflare KV and D1 database bindings.
 * @rationale Enables ultra-fast unit and integration testing of Cloudflare-targeted Shukoi actions in Vitest without requiring Miniflare, Docker, or native C++ SQLite bindings.
 * @preconditions Vitest or Web-Standard test runner; pure JavaScript runtime.
 * @invariants Pure in-memory state; zero node:* imports; zero external dependencies.
 */

/**
 * @purpose Structural interface for mockable Cloudflare KVNamespace operations.
 * @rationale Mirrors standard Cloudflare KV storage contracts for type safety.
 * @preconditions Valid string keys.
 * @param None
 * @returns Standard KVNamespace mock interface.
 * @throws Never throws on declaration.
 * @invariants Fully compatible with official Cloudflare KVNamespace type.
 */
export interface MockKvNamespace {
  get(key: string, type?: 'text'): Promise<string | null>;
  get<T = unknown>(key: string, type: 'json'): Promise<T | null>;
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>;
  getWithMetadata<T = unknown, M = unknown>(
    key: string,
    type?: 'text' | 'json' | 'arrayBuffer',
  ): Promise<{ value: T | null; metadata: M | null }>;
  put(
    key: string,
    value: string | ArrayBuffer,
    options?: { metadata?: unknown; expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{
    keys: { name: string; metadata?: unknown }[];
    list_complete: boolean;
  }>;
}

interface MockKvEntry {
  readonly value: string;
  readonly metadata?: unknown | undefined;
  readonly expiresAt?: number | undefined;
}

/**
 * @purpose Factory for lightweight in-memory Cloudflare KVNamespace test double.
 * @rationale Allows actions interacting with KV storage to be tested in pure Node/Bun/V8 in 1ms.
 * @preconditions Optional initial key-value record.
 * @param initialData Seed key-value map for priming the mock KV store.
 * @returns Instantiated MockKvNamespace test double backed by an in-memory Map.
 * @throws Never throws on creation.
 * @invariants State is localized to the returned instance; Big-O O(1) reads/writes.
 */
export function createMockKv(initialData?: Record<string, string>): MockKvNamespace {
  const store = new Map<string, MockKvEntry>();

  if (initialData) {
    for (const [k, v] of Object.entries(initialData)) {
      store.set(k, { value: v });
    }
  }

  return {
    get: (async (
      key: string,
      type: 'text' | 'json' | 'arrayBuffer' = 'text',
    ): Promise<string | unknown | ArrayBuffer | null> => {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
      }
      if (type === 'json') {
        try {
          return JSON.parse(entry.value);
        } catch {
          return null;
        }
      }
      if (type === 'arrayBuffer') {
        const encoder = new TextEncoder();
        return encoder.encode(entry.value).buffer;
      }
      return entry.value;
    }) as MockKvNamespace['get'],

    getWithMetadata: (async <T = unknown, M = unknown>(
      key: string,
      type: 'text' | 'json' | 'arrayBuffer' = 'text',
    ): Promise<{ value: T | null; metadata: M | null }> => {
      const entry = store.get(key);
      if (!entry) return { value: null, metadata: null };
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        store.delete(key);
        return { value: null, metadata: null };
      }
      let val: unknown = entry.value;
      if (type === 'json') {
        try {
          val = JSON.parse(entry.value);
        } catch {
          val = null;
        }
      } else if (type === 'arrayBuffer') {
        const encoder = new TextEncoder();
        val = encoder.encode(entry.value).buffer;
      }
      return { value: val as T | null, metadata: (entry.metadata as M | null) ?? null };
    }) as MockKvNamespace['getWithMetadata'],

    async put(
      key: string,
      value: string | ArrayBuffer,
      options?: { metadata?: unknown; expirationTtl?: number },
    ): Promise<void> {
      let strVal: string;
      if (typeof value === 'string') {
        strVal = value;
      } else {
        const decoder = new TextDecoder();
        strVal = decoder.decode(value);
      }

      const expiresAt = options?.expirationTtl
        ? Date.now() + options.expirationTtl * 1000
        : undefined;

      store.set(key, {
        value: strVal,
        ...(options?.metadata !== undefined ? { metadata: options.metadata } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      });
    },

    async delete(key: string): Promise<void> {
      store.delete(key);
    },

    async list(options?: { prefix?: string; limit?: number }): Promise<{
      keys: { name: string; metadata?: unknown }[];
      list_complete: boolean;
    }> {
      const prefix = options?.prefix ?? '';
      const limit = options?.limit ?? 1000;
      const keys: { name: string; metadata?: unknown }[] = [];

      for (const [k, v] of store.entries()) {
        if (v.expiresAt && Date.now() > v.expiresAt) {
          store.delete(k);
          continue;
        }
        if (k.startsWith(prefix)) {
          keys.push({ name: k, metadata: v.metadata });
          if (keys.length >= limit) break;
        }
      }

      return {
        keys,
        list_complete: true,
      };
    },
  };
}

/**
 * @purpose Prepared statement mock interface for Cloudflare D1 query operations.
 * @rationale Implements Cloudflare D1PreparedStatement contract for parameterized database queries.
 * @preconditions Valid SQL query string.
 * @param None
 * @returns Chainable D1 statement test double.
 * @throws Never throws on declaration.
 * @invariants Supports chaining .bind() and terminal execution methods.
 */
export interface MockD1PreparedStatement {
  bind(...values: unknown[]): MockD1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }>;
  run(): Promise<{
    success: boolean;
    meta: { changes: number; duration: number; last_row_id: number };
  }>;
  raw<T = unknown>(): Promise<T[]>;
}

/**
 * @purpose Structural interface for mockable Cloudflare D1Database operations.
 * @rationale Provides prepare, batch, and exec hooks matching Cloudflare D1 runtime interface.
 * @preconditions Valid SQL string queries.
 * @param None
 * @returns Standard D1Database mock interface.
 * @throws Never throws on declaration.
 * @invariants Matches Cloudflare D1Database API surface.
 */
export interface MockD1Database {
  prepare(query: string): MockD1PreparedStatement;
  batch<T = unknown>(
    statements: MockD1PreparedStatement[],
  ): Promise<{ results: T[]; success: boolean }[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}

/**
 * @purpose Factory for lightweight in-memory Cloudflare D1Database test double.
 * @rationale Enables instantaneous unit testing of database queries and transactions with zero SQLite dependencies.
 * @preconditions Optional query handler function or default result rows.
 * @param options Configuration specifying mock rows or dynamic SQL query handler.
 * @returns Instantiated MockD1Database test double.
 * @throws Never throws on creation.
 * @invariants Deterministic query resolution; Big-O O(1) response latency.
 */
export function createMockD1(options?: {
  defaultRows?: Record<string, unknown>[];
  queryHandler?: (sql: string, params: unknown[]) => Record<string, unknown>[] | undefined;
}): MockD1Database {
  const rows = options?.defaultRows ?? [];
  const handler = options?.queryHandler;

  function createStatement(query: string, boundParams: unknown[] = []): MockD1PreparedStatement {
    return {
      bind(...values: unknown[]): MockD1PreparedStatement {
        return createStatement(query, values);
      },

      async first<T = unknown>(colName?: string): Promise<T | null> {
        const resolved = handler ? handler(query, boundParams) : rows;
        const firstRow = resolved && resolved.length > 0 ? resolved[0] : null;
        if (!firstRow) return null;
        if (colName) {
          return (firstRow[colName] as T) ?? null;
        }
        return firstRow as T;
      },

      async all<T = unknown>(): Promise<{
        results: T[];
        success: boolean;
        meta: Record<string, unknown>;
      }> {
        const resolved = (handler ? handler(query, boundParams) : rows) ?? [];
        return {
          results: resolved as T[],
          success: true,
          meta: { duration: 1, served_by: 'mock-d1' },
        };
      },

      async run(): Promise<{
        success: boolean;
        meta: { changes: number; duration: number; last_row_id: number };
      }> {
        return {
          success: true,
          meta: { changes: 1, duration: 1, last_row_id: 1 },
        };
      },

      async raw<T = unknown>(): Promise<T[]> {
        const resolved = (handler ? handler(query, boundParams) : rows) ?? [];
        return resolved.map((r) => Object.values(r)) as T[];
      },
    };
  }

  return {
    prepare(query: string): MockD1PreparedStatement {
      return createStatement(query);
    },

    async batch<T = unknown>(
      statements: MockD1PreparedStatement[],
    ): Promise<{ results: T[]; success: boolean }[]> {
      const results: { results: T[]; success: boolean }[] = [];
      for (const stmt of statements) {
        const res = await stmt.all<T>();
        results.push({ results: res.results, success: res.success });
      }
      return results;
    },

    async exec(_query: string): Promise<{ count: number; duration: number }> {
      return { count: 1, duration: 1 };
    },
  };
}
