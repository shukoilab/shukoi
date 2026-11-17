---
name: shukoi-auth-rbac
description: Guides implementing enterprise multi-strategy authentication (JWKS, API Key, Session Cookie, OIDC) and declarative RBAC/ABAC authorization using @shukoi/auth in Shukoi applications. Use whenever actions require role boundaries, permission checks, or tenant ownership guards to prevent BOLA/IDOR.
compatibility: TypeScript 5.5+, @shukoi/core, @shukoi/auth
---

# Implementing Authentication & RBAC/ABAC in Shukoi

## Core Invariants for AI Coding Agents

1. **Constant-Time Crypto:** Always compare secrets, tokens, and cookie HMAC signatures using constant-time algorithms (`safeCompareSecrets` or Web Crypto bitwise XOR) to prevent timing side-channel attacks.
2. **Declarative BOLA/IDOR Prevention:** Always attach an ABAC `policy` to state-mutating actions to verify tenant ownership boundaries against the authenticated user context.
3. **Single-Flight Cache Stampede Guard:** When configuring JWKS or OIDC endpoints, rely on `SingleFlightJwksClient` to coalesce concurrent cache-miss requests into exactly one network fetch.
4. **RFC 9457 Error Compliance:** Unauthenticated requests must emit 401 `UNAUTHORIZED`; authenticated callers with insufficient roles, permissions, or failed policies must emit 403 `FORBIDDEN`.

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
} from '@shukoi/auth';

export const authResolver = createCompositeAuthResolver([
  createSessionCookieStrategy({
    secret: process.env.SESSION_SECRET!,
    cookieName: 'app_session',
    store: sessionStore,
  }),
  createJwksStrategy({
    jwksUri: process.env.JWKS_URI!,
    allowedAlgorithms: ['RS256', 'ES256'],
  }),
  createHashedApiKeyStrategy({
    apiKeyHeaderName: 'x-api-key',
    store: apiKeyStore,
  }),
]);
```
