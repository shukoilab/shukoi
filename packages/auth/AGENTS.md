# @shukoi/auth Package Constitution

## Local Scope & Boundaries

`@shukoi/auth` provides enterprise multi-strategy identity authentication (JWKS, API Key, Session Cookie, OIDC) and declarative RBAC/ABAC authorization guards for Shukoi applications.

### Invariants & Non-Negotiable Rules

1. **Constant-Time Cryptographic Comparison:**
   - All secret, session cookie HMAC signatures, and API key token comparisons MUST use constant-time algorithms (`safeCompareSecrets` or Web Crypto bitwise XOR) to prevent timing side-channel attacks.
2. **Zero `node:*` Imports (Edge Safe):**
   - The entire `@shukoi/auth` package MUST contain ZERO imports from `node:*` or native C++ addons.
   - All cryptographic operations must use Web Crypto (`crypto.subtle`) and `jose` for pure Web-standard isolate compatibility.
3. **Single-Flight Stampede Protection:**
   - Multi-tenant JWKS key discovery and OIDC token introspection MUST coalesce concurrent in-flight requests for identical endpoints using the Single-Flight Mutex pattern.
4. **Universal 7-Tag Docstrings:**
   - Every interface, class, method, function, and exported constant must include all 7 native docstring tags (`@purpose`, `@rationale`, `@preconditions`, `@param`, `@returns`, `@throws`, `@invariants`).
