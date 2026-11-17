/**
 * @purpose Automated unit and integration test suite for @shukoi/auth.
 * @rationale Validates multi-strategy authentication, session cookie HMAC signing, constant-time API key verification, and RBAC/ABAC guards.
 * @preconditions None.
 * @invariants Pure in-memory assertions; zero network side effects.
 */

import { DomainError } from '@shukoi/core';
import { describe, expect, it } from 'vitest';
import { evaluateActionAuth, hasRequiredPermissions, hasRequiredRoles } from '../src/guard.js';
import { createCompositeAuthResolver } from '../src/index.js';
import { createHashedApiKeyStrategy, hashApiKey } from '../src/strategies/api-key.js';
import {
  createSessionCookieStrategy,
  signSessionCookie,
  verifySessionCookie,
} from '../src/strategies/session.js';
import { MockApiKeyStore, MockSessionStore } from '../src/testing.js';

describe('@shukoi/auth Multi-Strategy & RBAC/ABAC Suite', () => {
  describe('Session Cookie Strategy (HMAC-SHA256)', () => {
    const secret = 'super-secret-key-32-chars-minimum-prod!';

    it('signs and verifies session cookies using constant-time HMAC-SHA256', async () => {
      const sessionId = 'ses_abc123456';
      const signed = await signSessionCookie(sessionId, secret);
      expect(signed.startsWith(`${sessionId}.`)).toBe(true);

      const verified = await verifySessionCookie(signed, secret);
      expect(verified).toBe(sessionId);

      // Tampered signature must fail
      const tampered = `${signed.slice(0, -4)}ffff`;
      const tamperedResult = await verifySessionCookie(tampered, secret);
      expect(tamperedResult).toBeNull();
    });

    it('authenticates valid session from SessionStore and rejects expired sessions', async () => {
      const store = new MockSessionStore();
      const strategy = createSessionCookieStrategy({
        secret,
        store,
        cookieName: 'my_session',
      });

      const sessionId = 'ses_user_789';
      const signed = await signSessionCookie(sessionId, secret);

      // 1. Session not in store -> 401
      await expect(strategy.authenticate({ cookie: `my_session=${signed}` })).rejects.toThrow(
        DomainError,
      );

      // 2. Valid session in store -> 200
      await store.set(
        sessionId,
        {
          sessionId,
          user: { id: 'usr_1', roles: ['admin'] },
          scopes: ['read:all', 'write:all'],
          expiresAt: Date.now() + 60_000,
        },
        60_000,
      );

      const auth = await strategy.authenticate({ cookie: `my_session=${signed}` });
      expect(auth).not.toBeNull();
      expect(auth?.user).toEqual({ id: 'usr_1', roles: ['admin'] });
      expect(auth?.scopes.has('read:all')).toBe(true);

      // 3. Expired session in store -> 401
      await store.set(
        sessionId,
        {
          sessionId,
          user: { id: 'usr_1' },
          scopes: [],
          expiresAt: Date.now() - 1000,
        },
        1000,
      );

      await expect(strategy.authenticate({ cookie: `my_session=${signed}` })).rejects.toThrow(
        DomainError,
      );
    });
  });

  describe('Hashed API Key Strategy', () => {
    it('verifies SHA-256 hashed API keys from dynamic ApiKeyStore', async () => {
      const store = new MockApiKeyStore();
      const strategy = createHashedApiKeyStrategy({
        store,
        apiKeyHeaderName: 'x-api-key',
      });

      const rawKey = 'shukoi_live_abcdef123456';
      const keyHash = await hashApiKey(rawKey);

      await store.addKey(keyHash, { id: 'service_worker', tenantId: 't1' }, ['metrics:write']);

      // 1. Valid API Key
      const auth = await strategy.authenticate({ 'x-api-key': rawKey });
      expect(auth).not.toBeNull();
      expect(auth?.user).toEqual({ id: 'service_worker', tenantId: 't1' });
      expect(auth?.scopes.has('metrics:write')).toBe(true);

      // 2. Invalid API Key -> 401
      await expect(strategy.authenticate({ 'x-api-key': 'wrong_key' })).rejects.toThrow(
        DomainError,
      );

      // 3. Header missing -> returns null (allows fallback to next strategy)
      const noHeader = await strategy.authenticate({});
      expect(noHeader).toBeNull();
    });

    it('verifies static API keys via O(1) constant-time pre-hashed lookup', async () => {
      const strategy = createHashedApiKeyStrategy({
        staticKeys: {
          static_secret_123: { user: { id: 'admin_user' }, scopes: ['admin:*'] },
        },
      });

      const auth = await strategy.authenticate({ 'x-api-key': 'static_secret_123' });
      expect(auth).not.toBeNull();
      expect(auth?.user).toEqual({ id: 'admin_user' });
      expect(auth?.scopes.has('admin:*')).toBe(true);

      await expect(strategy.authenticate({ 'x-api-key': 'invalid_secret' })).rejects.toThrow(
        DomainError,
      );
    });
  });

  describe('Composite Auth Resolver', () => {
    it('chains strategies in priority order (session cookie before API key)', async () => {
      const secret = 'test-secret-key-for-composite-resolver';
      const sessionStore = new MockSessionStore();
      const apiKeyStore = new MockApiKeyStore();

      const sessionStrategy = createSessionCookieStrategy({
        secret,
        store: sessionStore,
        cookieName: 'sid',
      });
      const apiKeyStrategy = createHashedApiKeyStrategy({
        store: apiKeyStore,
      });

      const resolver = createCompositeAuthResolver([sessionStrategy, apiKeyStrategy]);

      const sessionId = 'ses_primary';
      const signedCookie = await signSessionCookie(sessionId, secret);
      await sessionStore.set(
        sessionId,
        {
          sessionId,
          user: { source: 'session' },
          scopes: ['session:read'],
          expiresAt: Date.now() + 60_000,
        },
        60_000,
      );

      const apiKey = 'test_key';
      const apiKeyHash = await hashApiKey(apiKey);
      apiKeyStore.addKey(apiKeyHash, { source: 'api-key' });

      // Request with both cookie and API key: Session cookie must take precedence
      const res = await resolver({
        cookie: `sid=${signedCookie}`,
        'x-api-key': apiKey,
      });
      expect(res.user).toEqual({ source: 'session' });

      // Request with only API key: Falls through to API key
      const resApiKey = await resolver({
        'x-api-key': apiKey,
      });
      expect(resApiKey.user).toEqual({ source: 'api-key' });

      // Request with no credentials: Anonymous user
      const anon = await resolver({});
      expect(anon.user).toBeNull();
    });
  });

  describe('RBAC & ABAC Guard Evaluation', () => {
    it('evaluates role checks with OR logic and wildcard matching', () => {
      expect(hasRequiredRoles({ roles: ['admin', 'viewer'] }, ['admin'])).toBe(true);
      expect(hasRequiredRoles({ roles: ['viewer'] }, ['admin', 'editor'])).toBe(false);
      expect(hasRequiredRoles({ roles: ['*'] }, ['admin'])).toBe(true);
      expect(hasRequiredRoles(null, ['admin'])).toBe(false);
      expect(hasRequiredRoles({ role: 'admin' }, ['admin'])).toBe(true);
    });

    it('evaluates permission checks with AND logic and wildcard matching', () => {
      const scopes = new Set(['invoices:read', 'invoices:write']);
      expect(hasRequiredPermissions(scopes, ['invoices:read'])).toBe(true);
      expect(hasRequiredPermissions(scopes, ['invoices:read', 'invoices:delete'])).toBe(false);

      const wildcardScopes = new Set(['*']);
      expect(hasRequiredPermissions(wildcardScopes, ['invoices:delete'])).toBe(true);
    });

    it('enforces complete evaluateActionAuth rules including ABAC policy', async () => {
      const authConfig = {
        required: true,
        roles: ['admin'],
        permissions: ['billing:write'],
        policy: (ctx: { user: unknown }, input: { tenantId: string }) => {
          const u = ctx.user as { tenantId?: string } | null;
          return u?.tenantId === input.tenantId;
        },
      };

      // 1. Unauthenticated -> 401
      await expect(
        evaluateActionAuth(authConfig, null, new Set(), {}, { tenantId: 't1' }),
      ).rejects.toThrow(DomainError);

      // 2. Insufficient role -> 403
      await expect(
        evaluateActionAuth(
          authConfig,
          { id: 'u1', roles: ['viewer'], tenantId: 't1' },
          new Set(['billing:write']),
          {},
          { tenantId: 't1' },
        ),
      ).rejects.toThrow(DomainError);

      // 3. Missing permission -> 403
      await expect(
        evaluateActionAuth(
          authConfig,
          { id: 'u1', roles: ['admin'], tenantId: 't1' },
          new Set(['billing:read']),
          {},
          { tenantId: 't1' },
        ),
      ).rejects.toThrow(DomainError);

      // 4. Policy failure (tenant boundary violation) -> 403
      await expect(
        evaluateActionAuth(
          authConfig,
          { id: 'u1', roles: ['admin'], tenantId: 't1' },
          new Set(['billing:write']),
          {},
          { tenantId: 'tenant_other' },
        ),
      ).rejects.toThrow(DomainError);

      // 5. All criteria met -> resolves
      await expect(
        evaluateActionAuth(
          authConfig,
          { id: 'u1', roles: ['admin'], tenantId: 't1' },
          new Set(['billing:write']),
          {},
          { tenantId: 't1' },
        ),
      ).resolves.not.toThrow();
    });
  });
});
