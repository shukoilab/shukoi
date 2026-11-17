# @shukoi/auth

> **Enterprise Multi-Strategy Authentication & Declarative RBAC/ABAC Authorization for Shukoi**

[![npm version](https://img.shields.io/npm/v/@shukoi/auth.svg)](https://www.npmjs.com/package/@shukoi/auth)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`@shukoi/auth` delivers modular, production-ready identity management and granular access control for Shukoi REST APIs and Model Context Protocol (MCP) agents without vendor lock-in.

---

## Key Features & Invariants

- 🔐 **Multi-Strategy Resolution:** Seamlessly orchestrates JWT/JWKS, Hashed API Keys, HMAC-Signed Session Cookies, and RFC 7662 OIDC Token Introspection in a single composable resolver.
- 🛡️ **Declarative RBAC & ABAC:** Action-level security guards enforcing roles, capability permissions, and dynamic tenant/ownership policies, eliminating Broken Object Level Authorization (BOLA/IDOR) risks.
- ⚡ **$O(1)$ Pre-Hashed Static API Keys:** Static API keys are pre-hashed with SHA-256 at factory initialization, providing true $O(1)$ constant-time lookup immune to loop-position timing attacks.
- 🚀 **Single-Flight JWKS & Keystore Caching:** Coalesces concurrent in-flight JWKS fetches into one outbound request and caches the instantiated `createLocalJWKSet` keystore, eliminating per-verification rebuilds.
- 🛡️ **Zero Memory Leaks in OIDC Introspection:** Caches active token introspection decisions via an internal `BoundedLruCache` (cap: 5,000 entries) with TTL expiration, eliminating heap exhaustion under traffic floods.
- 🌐 **Pure Web-Standard Engine:** Zero `node:*` imports; 100% compatible with Cloudflare Workers V8 Isolates, AWS Lambda, Bun, and Node.js.
- 🧪 **Testing Harness:** Includes `MockSessionStore`, `MockApiKeyStore`, and credential fixtures in `@shukoi/auth/testing`.

---

## Installation

```bash
pnpm add @shukoi/auth @shukoi/core jose
```

---

## Strategy Configurations

### 1. Cached JWKS Strategy (OIDC / Auth0 / Clerk / Supabase)

Verifies standard Bearer JWT tokens against a remote JSON Web Key Set:

```typescript
import { createJwksStrategy } from '@shukoi/auth';

const jwksStrategy = createJwksStrategy({
  jwksUri: 'https://auth.example.com/.well-known/jwks.json',
  allowedAlgorithms: ['RS256', 'ES256'],
  issuer: 'https://auth.example.com/',
  audience: 'https://api.example.com',
  cacheTtlMs: 300_000, // 5 minutes local keystore cache
  fetchTimeoutMs: 5000, // 5 seconds fetch timeout
});
```

### 2. Hashed API Key Strategy (Static & Dynamic Stores)

Supports both $O(1)$ pre-hashed static keys (for machine-to-machine integrations) and dynamic database-backed stores:

```typescript
import { createHashedApiKeyStrategy } from '@shukoi/auth';

// Option A: Static API Keys (pre-hashed at initialization)
const staticApiKeyStrategy = createHashedApiKeyStrategy({
  apiKeyHeaderName: 'x-api-key',
  staticKeys: {
    sk_live_abc123456789: {
      user: { id: 'service_worker_1', role: 'service' },
      scopes: ['invoices:read', 'invoices:write'],
    },
  },
});

// Option B: Database / Dynamic API Key Store
const dynamicApiKeyStrategy = createHashedApiKeyStrategy({
  apiKeyHeaderName: 'x-api-key',
  store: {
    async findByKeyHash(keyHash) {
      // Look up key by SHA-256 hex hash in database
      const row = await db.apiKeys.findUnique({ where: { hash: keyHash } });
      if (!row) return null;
      return { user: { id: row.userId }, scopes: row.scopes };
    },
  },
});
```

### 3. HMAC-Signed Session Cookie Strategy

Validates stateful session identifiers from `Cookie` headers with HMAC-SHA256 signature verification:

```typescript
import { createSessionCookieStrategy } from '@shukoi/auth';

const sessionStrategy = createSessionCookieStrategy({
  secret: process.env.SESSION_SECRET!, // min 32 chars
  cookieName: 'sid',
  rollingTtlMs: 86_400_000, // 24 hours
  store: {
    async get(sessionId) {
      const data = await redis.get(`session:${sessionId}`);
      return data ? JSON.parse(data) : null;
    },
    async set(sessionId, data, ttlMs) {
      await redis.set(`session:${sessionId}`, JSON.stringify(data), 'PX', ttlMs);
    },
    async destroy(sessionId) {
      await redis.del(`session:${sessionId}`);
    },
  },
});
```

### 4. RFC 7662 OIDC Token Introspection Strategy

Validates opaque Bearer access tokens against centralized identity providers with bounded caching:

```typescript
import { createOidcIntrospectionStrategy } from '@shukoi/auth';

const oidcStrategy = createOidcIntrospectionStrategy({
  introspectionUrl: 'https://idp.example.com/oauth/v2/introspect',
  clientId: process.env.OAUTH_CLIENT_ID!,
  clientSecret: process.env.OAUTH_CLIENT_SECRET!,
  cacheTtlMs: 60_000, // Cache introspection decision for 1 minute
  fetchTimeoutMs: 5000, // Timeout with AbortSignal
});
```

---

## Composite Auth Resolver

Chain multiple authentication strategies in priority order:

```typescript
import { createCompositeAuthResolver } from '@shukoi/auth';

export const resolveAuth = createCompositeAuthResolver([
  sessionStrategy, // 1. Try session cookie first
  jwksStrategy, // 2. Fall back to Bearer JWT
  staticApiKeyStrategy, // 3. Fall back to static API key
]);

// Usage in HTTP handler:
const auth = await resolveAuth(request.headers);
console.log('Authenticated User:', auth.user);
console.log('Granted Scopes:', auth.scopes);
```

---

## Declarative Action Authorization (RBAC & ABAC)

Enforce fine-grained permissions at the action definition level:

```typescript
import { defineAction } from '@shukoi/core';
import { Type } from '@sinclair/typebox';

export const updateInvoiceAction = defineAction({
  name: 'updateInvoice',
  description: 'Updates invoice details with role and tenant boundary check',
  authRequired: true,
  auth: {
    roles: ['admin', 'billing_manager'],
    permissions: ['invoices:write'],
    policy: (auth, input) => {
      // Prevents BOLA/IDOR: caller can only update invoices belonging to their tenant
      const user = auth.user as { tenantId?: string } | null;
      return user?.tenantId === input.tenantId;
    },
  },
  input: Type.Object({
    tenantId: Type.String(),
    invoiceId: Type.String(),
    amountCents: Type.Integer({ minimum: 100 }),
  }),
  output: Type.Object({
    success: Type.Boolean(),
  }),
  async handler(input, ctx) {
    ctx.logger.info('Updating invoice', { id: input.invoiceId });
    return { success: true };
  },
});
```

---

## Testing Without External Identity Providers

Use mock stores from `@shukoi/auth/testing` in unit tests:

```typescript
import { MockApiKeyStore, MockSessionStore } from '@shukoi/auth/testing';
import { createHashedApiKeyStrategy, hashApiKey } from '@shukoi/auth';

const store = new MockApiKeyStore();
const hashed = await hashApiKey('my-secret-key');
await store.addKey(hashed, { id: 'test-user' }, ['read:all']);

const strategy = createHashedApiKeyStrategy({ store });
const res = await strategy.authenticate({ 'x-api-key': 'my-secret-key' });
expect(res?.user).toEqual({ id: 'test-user' });
```
