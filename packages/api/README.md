# @shukoi/api

> **Protocol Module A: Hono REST Router, OpenAPI 3.1.0 Generator & Stream-Bounded Reader**

[![npm version](https://img.shields.io/npm/v/@shukoi/api.svg)](https://www.npmjs.com/package/@shukoi/api)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Pure Web Standard](https://img.shields.io/badge/Runtime-Pure_Web_Standard-success.svg)](https://github.com/shukoilab/shukoi)

`@shukoi/api` exposes declarative Shukoi actions over standard HTTP REST interfaces powered by Hono. It automatically compiles synchronized OpenAPI 3.1.0 specifications directly from frozen TypeBox schemas, enforces chunked transfer OOM defenses, handles multi-value array query parameters, and serializes operational failures to RFC 9457 Problem Details (`application/problem+json`).

---

## Key Features & Invariants

- **Auto-Generated OpenAPI 3.1.0 Documentation:** Automatically compiles frozen action schemas into a living OpenAPI 3.1 specification at `/openapi.json`. Automatically extracts query parameters for `GET` and `DELETE` operations, registers `components.securitySchemes` (`bearerAuth` and `apiKeyAuth`), sets operation `security` requirements on authenticated actions, and defines root `servers: [{ url: '/' }]`.
- **Stream-Level Bounded Ingress (`readBoundedJsonStream`):** Reads chunked HTTP streams chunk-by-chunk with a cumulative byte counter. If received bytes exceed `config.limits.maxBodyBytes`, the reader is immediately cancelled and throws HTTP 413 without buffering the remainder into memory.
- **Deterministic Parameter Merge Priority:** Strict merge priority guarantees that path variables (`:id`) always take precedence:
  $$\text{Query Params} < \text{JSON Body} < \text{Path Params}$$
  Path parameters can never be overwritten or poisoned by body fields or query strings.
- **Universal RFC 9457 Problem Details:** All runtime errors, validation failures (422), authentication rejections (401/403), payload size breaches (413), and unmapped routes (404 via `app.notFound()`) return standard `application/problem+json` envelopes with `type`, `title`, `status`, `detail`, `code`, `instance`, and `requestId`.
- **Safe Primitive Coercion:** Coerces string query parameters into numbers and booleans safely, while **strictly preserving leading-zero numeric strings** (e.g. `"01234"`, `"007"`) as strings to prevent validation corruption on postal codes, NIK, or phone numbers.
- **Multi-Value Array Query Parameters:** Uses Hono's `c.req.queries()` to gracefully ingest array query parameters (e.g. `?tags=node&tags=bun` or `?tags[]=edge`), coercing elements and providing native arrays to action schemas.
- **Custom Content-Type Support:** Respects `action.http.customContentType` for non-JSON responses (such as `text/csv`, `image/svg+xml`, or `text/plain`).
- **Idempotency Replay Indication:** Emits the standard `Idempotent-Replayed: true` header when returning cached idempotent executions.
- **Built-in CORS & Preflight:** Automatically handles CORS preflight `OPTIONS` and validates incoming `Origin` against `config.security.allowedOrigins`.
- **Pure Web-Standard Engine:** Contains strictly zero `node:*` imports; 100% compatible with Cloudflare Workers isolates, AWS Lambda, Bun, and Node.js.

---

## Installation

```bash
pnpm add @shukoi/api @shukoi/core hono @sinclair/typebox
# or
npm install @shukoi/api @shukoi/core hono @sinclair/typebox
# or
bun add @shukoi/api @shukoi/core hono @sinclair/typebox
```

---

## Quickstart

```typescript
import { createRestRouter } from '@shukoi/api';
import { createDefaultConfig } from '@shukoi/core';
import { myAction } from './actions/myAction.js';

const config = createDefaultConfig({
  security: {
    allowedOrigins: ['https://app.example.com'],
  },
});

// Create Hono REST application exposing actions
export const app = createRestRouter([myAction], config);

// Serve OpenAPI 3.1 specification at /openapi.json
// Execute routes with Hono: app.request('/my-action', { method: 'POST', ... })
```

---

## API Reference

### `createRestRouter(actions, config, options?)`

Creates a configured Hono application mounting all actions where `action.http` is declared.

- Automatically mounts `/openapi.json`.
- Configures CORS middleware.
- Configures universal RFC 9457 error handler and 404 route handler.
- Supports multi-value array query parameters and custom content types.
- Emits `Idempotent-Replayed: true` headers on cached idempotency hits.

### `readBoundedJsonStream(stream, maxBytes)`

Reads a `ReadableStream<Uint8Array>` up to `maxBytes` without trusting the `Content-Length` header. Cancels the stream reader immediately upon threshold breach with HTTP 413 and parses UTF-8 JSON.

### `generateOpenApiSpec(actions, config)`

Generates an OpenAPI 3.1.0 JSON-serializable specification document from an array of `CompiledAction` instances, including query parameters, security schemes, and server definitions.

### `coercePrimitiveParam(raw)`

Coerces string-based query or path parameter values into primitives based on value appearance, while preserving strings with leading zeros (e.g. `"01234"`).

### `extractHeaders(req)`

Extracts and normalizes all incoming request headers into a lowercase string record.

---

## Related Documentation & Architecture

- **System Architecture:** [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) (Deep dive into Protocol Module A, parameter merging, and OOM defense).
- **Action Creation Skill:** [skills/shukoi-create-action](../../skills/shukoi-create-action/SKILL.md) (Step-by-step procedural guide for creating actions).
- **Deployment Skill:** [skills/shukoi-deploy-target](../../skills/shukoi-deploy-target/SKILL.md) (Deploying across Cloudflare, Lambda, and Self-Host).

---

## License

MIT © [Shukoi Contributors](https://github.com/shukoilab/shukoi)
