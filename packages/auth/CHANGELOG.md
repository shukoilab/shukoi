# @shukoi/auth

## 1.0.3

### Initial Release & Hardening

- Initial release of `@shukoi/auth`: Enterprise multi-strategy authentication and declarative RBAC/ABAC authorization for Shukoi applications.
- **Multi-Strategy Resolver**: Composite resolver chaining JWKS, Hashed API Keys, Signed Session Cookies, and RFC 7662 OIDC Token Introspection in deterministic priority order.
- **$O(1)$ Pre-Hashed Static API Keys**: Pre-hashes static keys at initialization to provide constant-time authentication immune to loop-position timing attacks.
- **Bounded OIDC Token Cache**: Replaced unbounded memory structures with `BoundedLruCache(5000)` with TTL eviction, preventing OOM under heavy traffic.
- **Optimized JWKS Caching**: Caches instantiated `createLocalJWKSet` keystores during `cacheTtlMs`, eliminating per-verification JSON Web Key rebuilds.
- **UTF-8 Safe Basic Auth**: Enhanced RFC 7662 Basic authentication client credentials encoding for international and UTF-8 secrets.
- **Declarative RBAC & ABAC**: Action-level guards for required roles (`roles`), capability scopes (`permissions`), and dynamic tenant/ownership policies (`policy`), eliminating BOLA/IDOR vulnerabilities.
- **In-Memory Testing Harness**: Provided `@shukoi/auth/testing` with `MockSessionStore`, `MockApiKeyStore`, and test credential utilities.
