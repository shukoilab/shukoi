---
name: shukoi-auth-rbac
description: Guides implementing enterprise multi-strategy authentication (JWKS, API Key, Session Cookie, OIDC) and declarative RBAC/ABAC authorization using @shukoi/auth in Shukoi applications. Use whenever actions require role boundaries, permission checks, or tenant ownership guards to prevent BOLA/IDOR.
compatibility: TypeScript 5.5+, @shukoi/core, @shukoi/auth
---

# Implementing Authentication & RBAC/ABAC in Shukoi

## Core Invariants for AI Coding Agents

1. **Constant-Time Crypto & Pre-Hashing:** Always pre-hash static API keys at factory initialization (`staticKeys`) for $O(1)$ constant-time lookup. Secret comparisons and cookie HMAC signatures MUST use constant-time operations to prevent timing side-channels.
2. **Declarative BOLA/IDOR Prevention:** Always attach an ABAC `policy` to state-mutating actions to verify tenant ownership boundaries against the authenticated user context.
3. **Single-Flight Cache Stampede Guard & Keystore Caching:** Remote JWKS key discovery and OIDC token introspection coalesce concurrent in-flight requests using the Single-Flight Mutex pattern and cache the instantiated keystore during `cacheTtlMs`.
4. **Bounded OIDC Memory Protection:** Token introspection decisions MUST be cached using `BoundedLruCache` (cap: 5,000 entries) with TTL expiration to eliminate memory leaks.
5. **RFC 9457 Error Compliance:** Unauthenticated requests must emit 401 `UNAUTHORIZED`; authenticated callers with insufficient roles, permissions, or failed policies must emit 403 `FORBIDDEN`.

---

## 1. Declarative Action Authorization Example

```typescript
import { defineAction } from '@shukoi/core';
import { Type } from '@sinclair/typebox';

export const updateAccountAction = defineAction({
  name: 'updateAccount',
  description: 'Updates account profile with RBAC and ABAC tenant guard',
  authRequired: true,
  auth: {
    roles: ['admin', 'account_owner'],
    permissions: ['accounts:write'],
    policy: (auth, input) => {
      const user = auth.user as { tenantId?: string } | null;
      return user?.tenantId === input.tenantId;
    },
  },
  input: Type.Object({
    tenantId: Type.String(),
    accountId: Type.String(),
    displayName: Type.String({ minLength: 1 }),
  }),
  output: Type.Object({
    success: Type.Boolean(),
  }),
  async handler(input, ctx) {
    ctx.logger.info('Updating account', { id: input.accountId });
    return { success: true };
  },
});
```

---

## 2. Multi-Strategy Auth Setup

```typescript
import {
  createCompositeAuthResolver,
  createSessionCookieStrategy,
  createJwksStrategy,
  createHashedApiKeyStrategy,
  createOidcIntrospectionStrategy,
} from '@shukoi/auth';

export const authResolver = createCompositeAuthResolver([
  // 1. Session Cookie strategy (requires SessionStore implementation)
  createSessionCookieStrategy({
    secret: process.env.SESSION_SECRET!,
    cookieName: 'app_session',
    store: sessionStore,
    rollingTtlMs: 86_400_000,
  }),

  // 2. JWT Bearer strategy with cached keystore
  createJwksStrategy({
    jwksUri: process.env.JWKS_URI!,
    allowedAlgorithms: ['RS256', 'ES256'],
    cacheTtlMs: 300_000,
  }),

  // 3. Hashed API Key strategy (with O(1) pre-hashed staticKeys)
  createHashedApiKeyStrategy({
    apiKeyHeaderName: 'x-api-key',
    staticKeys: {
      'sk_live_my_service_key': {
        user: { id: 'svc_internal', role: 'service' },
        scopes: ['accounts:write'],
      },
    },
  }),

  // 4. RFC 7662 OIDC Token Introspection
  createOidcIntrospectionStrategy({
    introspectionUrl: process.env.OAUTH_INTROSPECTION_URL!,
    clientId: process.env.OAUTH_CLIENT_ID!,
    clientSecret: process.env.OAUTH_CLIENT_SECRET!,
    cacheTtlMs: 60_000,
  }),
]);
```
