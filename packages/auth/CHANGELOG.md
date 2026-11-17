# @shukoi/auth

## 1.0.3

### Initial Release

- Initial release of `@shukoi/auth`: Enterprise multi-strategy authentication and declarative RBAC/ABAC authorization for Shukoi applications.
- **Multi-Strategy Resolver**: Composite resolver chaining JWKS, Hashed API Keys, Signed Session Cookies, and RFC 7662 OIDC Token Introspection in deterministic priority order.
- **Constant-Time Crypto**: Bitwise XOR timing side-channel defense across all secret and session token checks.
- **Declarative RBAC & ABAC**: Action-level guards for required roles (`roles`), capability scopes (`permissions`), and dynamic tenant/ownership policies (`policy`), eliminating BOLA/IDOR vulnerabilities.
- **In-Memory Testing Harness**: Provided `@shukoi/auth/testing` with `MockSessionStore`, `MockApiKeyStore`, and test credential utilities.
