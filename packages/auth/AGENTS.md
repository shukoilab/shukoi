# @shukoi/auth Package Constitution

## Local Scope & Boundaries

`@shukoi/auth` provides enterprise multi-strategy identity authentication (JWKS, API Key, Session Cookie, OIDC) and declarative RBAC/ABAC authorization guards for Shukoi applications.

### Invariants & Non-Negotiable Rules

1. **Constant-Time Cryptographic Comparison & Pre-Hashing:**
   - Static API keys configured via `staticKeys` MUST be pre-hashed at strategy initialization, enabling $O(1)$ constant-time lookup and eliminating timing side-channels.
   - Session cookie HMAC signatures and secret comparisons MUST use constant-time operations (`safeCompareSecrets` or Web Crypto bitwise XOR).
2. **Bounded Memory in Token Introspection ($O(1)$ Space Ceiling):**
   - Active OIDC token introspection decisions MUST be cached using `BoundedLruCache` with a strict upper ceiling (cap: 5,000 entries) and TTL expiration. Unbounded `Map` caches are strictly prohibited.
3. **Zero `node:*` Imports (Edge Safe):**
   - The entire `@shukoi/auth` package MUST contain ZERO imports from `node:*` or native C++ addons.
   - All cryptographic operations must use Web Crypto (`crypto.subtle`) and `jose` for pure Web-standard isolate compatibility.
4. **Single-Flight Stampede Protection & Keystore Caching:**
   - Remote JWKS key discovery and OIDC token introspection MUST coalesce concurrent in-flight requests using the Single-Flight Mutex pattern.
   - The instantiated `createLocalJWKSet` keystore MUST be cached for the duration of `cacheTtlMs`.
5. **Universal 7-Tag Docstrings:**
   - Every interface, class, method, function, and exported constant must include all 7 native docstring tags (`@purpose`, `@rationale`, `@preconditions`, `@param`, `@returns`, `@throws`, `@invariants`).
