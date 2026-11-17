/**
 * @purpose In-memory test doubles and mock stores for @shukoi/auth testing.
 * @rationale Enables deterministic unit and integration testing of auth strategies without network or DB dependencies.
 * @preconditions None.
 * @invariants Pure in-memory maps; thread-safe across concurrent test runners.
 */

import type { AuthResult } from '@shukoi/core';
import type { ApiKeyStore, SessionData, SessionStore } from './types.js';

/**
 * @purpose In-memory implementation of SessionStore.
 */
export class MockSessionStore<TUser = unknown> implements SessionStore<TUser> {
  private readonly sessions = new Map<string, SessionData<TUser>>();

  public async get(sessionId: string): Promise<SessionData<TUser> | null> {
    const data = this.sessions.get(sessionId);
    return data ?? null;
  }

  public async set(sessionId: string, data: SessionData<TUser>, _ttlMs: number): Promise<void> {
    this.sessions.set(sessionId, data);
  }

  public async destroy(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  public clear(): void {
    this.sessions.clear();
  }
}

/**
 * @purpose In-memory implementation of ApiKeyStore.
 */
export class MockApiKeyStore<TUser = unknown> implements ApiKeyStore<TUser> {
  private readonly keys = new Map<string, { user: Readonly<TUser>; scopes: readonly string[] }>();

  public addKey(keyHash: string, user: TUser, scopes: readonly string[] = ['*']): void {
    this.keys.set(keyHash, { user: Object.freeze(user), scopes: Object.freeze(scopes) });
  }

  public async findByKeyHash(
    keyHash: string,
  ): Promise<{ user: Readonly<TUser>; scopes: readonly string[] } | null> {
    return this.keys.get(keyHash) ?? null;
  }

  public clear(): void {
    this.keys.clear();
  }
}

/**
 * @purpose Creates a mock AuthResult for unit testing action handlers.
 */
export function createMockAuthResult<TUser = unknown>(
  user: TUser,
  scopes: readonly string[] = ['*'],
  token = 'mock_token',
): AuthResult<TUser> {
  return {
    user: Object.freeze(user),
    scopes: Object.freeze(new Set(scopes)),
    token,
  };
}
