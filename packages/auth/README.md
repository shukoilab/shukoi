# @shukoi/auth

> **Enterprise Multi-Strategy Authentication & Declarative RBAC/ABAC Authorization for Shukoi.**

`@shukoi/auth` delivers modular, production-ready identity management and granular access control for Shukoi REST APIs and Model Context Protocol (MCP) agents without vendor lock-in.

---

## Features

- 🔐 **Multi-Strategy Resolution:** Seamlessly orchestrates JWT/JWKS, Hashed API Keys, HMAC-Signed Session Cookies, and RFC 7662 OIDC Token Introspection in a single composable resolver.
- 🛡️ **Declarative RBAC & ABAC:** Action-level security guards enforcing roles, capability permissions, and dynamic tenant/ownership policies, eliminating Broken Object Level Authorization (BOLA/IDOR) risks.
- ⏱️ **Constant-Time Crypto:** Web Crypto bitwise XOR comparisons protect all token and signature checks against timing side-channel attacks.
- 🚀 **Single-Flight JWKS Stampede Protection:** Coalesces hundreds of concurrent cache-miss requests into exactly one outbound identity provider fetch.
- 🌐 **Pure Web-Standard Engine:** Zero `node:*` dependencies; 100% compatible with Cloudflare Workers V8 Isolates, AWS Lambda, and Node/Bun.
- 🧪 **Testing Harness:** Includes `MockSessionStore`, `MockApiKeyStore`, and pre-configured credential fixtures in `@shukoi/auth/testing`.

---

## Installation

```bash
pnpm add @shukoi/auth @shukoi/core
```

---

## Usage

### 1. Declarative Action Authorization (RBAC & ABAC)

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

### 2. Composite Auth Resolver Setup

```typescript
import {
  createCompositeAuthResolver,
  createJwksStrategy,
  createHashedApiKeyStrategy,
  createSessionCookieStrategy,
} from '@shukoi/auth';

const authResolver = createCompositeAuthResolver([
  createSessionCookieStrategy({
    secret: process.env.SESSION_SECRET!,
    cookieName: 'shukoi_session',
  }),
  createJwksStrategy({
    jwksUri: 'https://auth.example.com/.well-known/jwks.json',
    allowedAlgorithms: ['RS256', 'ES256'],
  }),
  createHashedApiKeyStrategy({
    apiKeyHeaderName: 'x-api-key',
  }),
]);
```

---

## License

MIT © [shukoilab](https://github.com/shukoilab)
