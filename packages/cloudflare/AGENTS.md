# @shukoi/cloudflare Package Constitution

## Local Scope & Boundaries

`@shukoi/cloudflare` adapts Shukoi Hono applications to Cloudflare Workers V8 Isolate sandboxes.

### Invariants & Non-Negotiable Rules

1. **Zero `node:*` Imports:** Absolute prohibition of Node.js modules or native C++ addons.
2. **Environment Injection:** Passes `env` (D1, KV, R2, Queues) into `ctx.platform.env`.
3. **Execution Lifecycle:** Routes post-response cleanup tasks into `executionCtx.waitUntil(...)` so lock releases and telemetry complete after HTTP response delivery.
