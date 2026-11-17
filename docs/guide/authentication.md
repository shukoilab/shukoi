# Enterprise Multi-Strategy Authentication

> **Pluggable authentication (JWKS, Hashed API Keys, Signed Session Cookies, OIDC) with constant-time crypto defense.**

Shukoi applications serve diverse clients: web browsers using session cookies, mobile apps using OAuth2 Bearer tokens, third-party partners using API keys, and internal services using opaque access tokens.

`@shukoi/auth` provides a composable strategy architecture that validates caller identity in deterministic priority order while guaranteeing constant-time cryptographic comparisons and Single-Flight cache stampede protection.

---

## 1. Supported Strategies

| Strategy | Factory Function | Target Clients | Security Invariant |
| :--- | :--- | :--- | :--- |
| **JWKS / JWT Bearer** | `createJwksStrategy()` | SPAs, Mobile Apps, Microservices | Single-Flight key discovery; cached local keystore; strict algorithm pinning (`RS256`, `ES256`). |
| **Hashed API Key** | `createHashedApiKeyStrategy()` | M2M Integrations, Webhooks, Partners | Static keys pre-hashed at initialization for $O(1)$ constant-time lookup; dynamic store via SHA-256 hash lookup. |
| **Signed Session Cookie** | `createSessionCookieStrategy()` | Web Browsers, SSR Dashboards | HMAC-SHA256 signature verification over caller-supplied `SessionStore` (`get`, `set`, `destroy`). |
| **RFC 7662 OIDC** | `createOidcIntrospectionStrategy()` | Centralized IdP (Keycloak, Okta) | Coalesced in-flight queries; bounded memory cache via `BoundedLruCache(5000)`. |

---

## 2. Setting Up a Composite Auth Resolver

Chain multiple authentication strategies in priority order using `createCompositeAuthResolver`:

```typescript
import {
  createCompositeAuthResolver,
  createSessionCookieStrategy,
  createJwksStrategy,
  createHashedApiKeyStrategy,
  createOidcIntrospectionStrategy,
} from '@shukoi/auth';

export const authResolver = createCompositeAuthResolver([
  // 1. Check browser session cookie first (requires SessionStore)
  createSessionCookieStrategy({
    secret: process.env.SESSION_SECRET!,
    cookieName: 'app_session',
    rollingTtlMs: 86_400_000,
    store: redisSessionStore,
  }),

  // 2. Fall back to JWT Bearer header with cached JWKS keystore
  createJwksStrategy({
    jwksUri: 'https://auth.example.com/.well-known/jwks.json',
    allowedAlgorithms: ['RS256', 'ES256'],
    issuer: 'https://auth.example.com/',
    cacheTtlMs: 300_000,
  }),

  // 3. Fall back to API Key header (supports pre-hashed staticKeys or dynamic store)
  createHashedApiKeyStrategy({
    apiKeyHeaderName: 'x-api-key',
    staticKeys: {
      'sk_live_enterprise_secret_123': {
        user: { id: 'partner_service', role: 'partner' },
        scopes: ['invoices:read', 'invoices:write'],
      },
    },
  }),

  // 4. Fall back to RFC 7662 OIDC Token Introspection
  createOidcIntrospectionStrategy({
    introspectionUrl: 'https://idp.example.com/oauth/v2/introspect',
    clientId: process.env.OAUTH_CLIENT_ID!,
    clientSecret: process.env.OAUTH_CLIENT_SECRET!,
    cacheTtlMs: 60_000,
  }),
]);
```

---

## 3. Constant-Time Security & Stampede Defense

1. **Constant-Time Verification:** Standard string comparisons (`===`) terminate on the first non-matching byte, leaking secret length and prefix timing information. `@shukoi/auth` hashes inputs via SHA-256 and computes bitwise XOR across the full 32-byte digest in constant time.
2. **Single-Flight Cache Stampede Guard:** When high-concurrency traffic hits an edge worker with an expired JWKS cache, `@shukoi/auth` shares a single in-flight promise across all concurrent requests, firing exactly one outbound network request to the identity provider.
