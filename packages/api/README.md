# @shukoi/api

> **Protocol Module A: Hono REST Router, OpenAPI 3.1.0 Generator & Stream-Bounded Reader**

[![npm version](https://img.shields.io/npm/v/@shukoi/api.svg)](https://www.npmjs.com/package/@shukoi/api)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Pure Web Standard](https://img.shields.io/badge/Runtime-Pure_Web_Standard-success.svg)](https://github.com/shukoilab/shukoi)

`@shukoi/api` exposes declarative Shukoi actions over standard HTTP REST interfaces powered by Hono. It automatically generates synchronized OpenAPI 3.1.0 specifications directly from frozen TypeBox schemas, enforces chunked transfer OOM defenses, and serializes operational failures to RFC 9457 Problem Details (`application/problem+json`).

---

## Key Features & Invariants

- **Auto-Generated OpenAPI 3.1.0 Documentation:** Automatically compiles frozen action schemas into a living OpenAPI 3.1 JSON specification exposed at `/openapi.json`.
- **Stream-Bounded Body Reader (`readBoundedJsonStream`):** Reads chunked HTTP streams chunk-by-chunk with a cumulative byte counter. If received bytes exceed `config.limits.maxBodyBytes`, the reader is immediately cancelled and throws HTTP 413 without buffering the remainder into memory.
- **Deterministic Parameter Merge Priority:** Strict merge priority guarantees that path variables (`:id`) always take precedence:
  $$\text{Query Params} < \text{JSON Body} < \text{Path Params}$$
  Path parameters can never be overwritten or poisoned by body fields or query strings.
- **RFC 9457 Problem Details:** Errors conform to `application/problem+json` standards containing `type`, `title`, `status`, `detail`, `instance`, and `requestId`.
- **Built-in CORS & Preflight:** Automatically handles CORS preflight `OPTIONS` and validates incoming `Origin` against `config.security.allowedOrigins`.
- **Pure Web-Standard Engine:** Contains zero `node:*` imports; 100% compatible with Cloudflare Workers isolates, AWS Lambda, Bun, and Node.js.

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
- Configures RFC 9457 error handler.

### `readBoundedJsonStream(stream, maxBytes)`

Reads a `ReadableStream<Uint8Array>` up to `maxBytes` without trusting the `Content-Length` header. Cancels the stream reader immediately upon threshold breach and parses UTF-8 JSON.

### `generateOpenApiSpec(actions, config)`

Generates an OpenAPI 3.1.0 JSON-serializable specification document from an array of `CompiledAction` instances.

---

## License

MIT © [Shukoi Contributors](https://github.com/shukoilab/shukoi)
