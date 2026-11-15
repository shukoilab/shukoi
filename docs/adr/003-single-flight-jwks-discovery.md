# ADR 003: Single-Flight Mutex Pattern for Remote JWKS Discovery

## Status
Accepted

## Context
When verifying JSON Web Tokens (JWT) using a remote JSON Web Key Set (`jwksUri`), keys are cached in memory for a configured TTL (`jwksCacheTtlMs`). When this cache expires, an application receiving hundreds of concurrent requests simultaneously attempts to refresh the keys. Without deduplication, this causes a JWKS cache stampede, triggering hundreds of duplicate outbound HTTP requests to the identity provider, leading to rate-limiting (`429 Too Many Requests`) or socket exhaustion.

## Decision
In `@shukoi/core/src/auth.ts`, implement `SingleFlightJwksClient`:
1. Use an internal `inFlightPromise` variable.
2. If cache is expired or empty:
   - If an `inFlightPromise` is already running, subsequent callers simply await that existing promise.
   - If no promise is running, initialize exactly one network fetch wrapped in a `try/finally` block that resets `inFlightPromise = null`.
3. Cached keys are stored with explicit expiration timestamps (`cacheExpiresAt`).

## Consequences for AI Agents
**DO NOT REMOVE THE `inFlightPromise` MUTEX.**
- Do not replace `SingleFlightJwksClient` with an uncoordinated `fetch(jwksUri)` on every request.
- Tested and verified in `packages/core/test/auth.test.ts` where 50 concurrent requests trigger exactly 1 outbound HTTP fetch.
