# @shukoi/api Package Constitution

## Local Scope & Boundaries

`@shukoi/api` implements Protocol Module A: Hono REST routing, OpenAPI 3.1.0 document generation, and RFC 9457 Problem Details error formatting.

### Invariants & Non-Negotiable Rules

1. **Zero `node:*` Imports:** Pure web standard; compatible with Cloudflare Workers isolates.
2. **Deterministic Parameter Merge Priority:** Parameter merging must strictly enforce `Query Params < JSON Body < Path Params`. Path parameters (`:id`) must never be overridden by query strings or JSON bodies.
3. **Stream-Bounded Reader:** Mutating routes (`POST`, `PUT`, `PATCH`) must read request bodies through `readBoundedJsonStream` with `config.limits.maxBodyBytes` ceiling. Never call unbounded `c.req.json()`.
4. **RFC 9457 Error Responses:** Errors must return `application/problem+json` with standard fields (`type`, `title`, `status`, `detail`, `requestId`, `code`).
5. **OpenAPI 3.1.0 Generation:** Schema documentation is derived automatically from frozen TypeBox schemas at `/openapi.json`.
