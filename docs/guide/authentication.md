# Enterprise Multi-Strategy Authentication

> **Pluggable authentication (JWKS, Hashed API Keys, Signed Session Cookies, OIDC) with constant-time crypto defense.**

Shukoi applications serve diverse clients: web browsers using session cookies, mobile apps using OAuth2 Bearer tokens, third-party partners using API keys, and internal services using opaque access tokens.

`@shukoi/auth` provides a composable strategy architecture that validates caller identity in deterministic priority order while guaranteeing constant-time cryptographic comparisons and Single-Flight cache stampede protection.

---

## 1. Supported Strategies

| Strategy | Factory Function | Target Clients | Security Invariant |
| :--- | :--- | :--- | :--- |
| **JWKS / JWT Bearer** | `createJwksStrategy()` | SPAs, Mobile Apps, Microservices | Single-Flight key discovery; strict algorithm pinning (`RS256`, `ES256`). |
| **Hashed API Key** | `createHashedApiKeyStrategy()` | M2M Integrations, Webhooks, Partners | Raw keys never stored plaintext; compared using constant-time Web Crypto XOR. |
| **Signed Session Cookie** | `createSessionCookieStrategy()` | Web Browsers, SSR Dashboards | `HttpOnly; Secure; SameSite=Lax`; HMAC-SHA256 signature verification. |
| **RFC 7662 OIDC** | `createOidcIntrospectionStrategy()` | Centralized IdP (Keycloak, Okta) | Coalesced in-flight network queries; short-lived TTL caching. |

---

## 2. Setting Up a Composite Auth Resolver

Chain multiple authentication strategies in priority order using `createCompositeAuthResolver`:

```typescript
import {
  createCompositeAuthResolver,
  createSessionCookieStrategy,
  createJwksStrategy,
  createHashedApiKeyStrategy,
} from '@shukoi/auth';

export const authResolver = createCompositeAuthResolver([
  // 1. Check browser session cookie first
  createSessionCookieStrategy({
    secret: process.env.SESSION_SECRET!,
    cookieName: 'app_session',
    store: redisSessionStore,
  }),

  // 2. Fall back to JWT Bearer header
  createJwksStrategy({
    jwksUri: 'https://auth.example.com/.well-known/jwks.json',
    allowedAlgorithms: ['RS256', 'ES256'],
    issuer: 'https://auth.example.com/',
  }),

  // 3. Fall back to API Key header
  createHashedApiKeyStrategy({
    apiKeyHeaderName: 'x-api-key',
    store: databaseApiKeyStore,
  }),
]);
```

---

## 3. Constant-Time Security & Stampede Defense

1. **Constant-Time Verification:** Standard string comparisons (`===`) terminate on the first non-matching byte, leaking secret length and prefix timing information. `@shukoi/auth` hashes inputs via SHA-256 and computes bitwise XOR across the full 32-byte digest in constant time.
2. **Single-Flight Cache Stampede Guard:** When high-concurrency traffic hits an edge worker with an expired JWKS cache, `@shukoi/auth` shares a single in-flight promise across all concurrent requests, firing exactly one outbound network request to the identity provider.
