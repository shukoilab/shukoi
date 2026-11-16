# Protocol Module A: REST, OpenAPI 3.1.0 & RFC 9457

`@shukoi/api` exposes declarative actions over Web-Standard HTTP REST endpoints using Hono as the underlying routing kernel, without binding to any Node.js built-ins.

---

## Architectural Invariants

### 1. Deterministic Parameter Merge Priority
To prevent path-override injection attacks, parameters are strictly merged in ascending precedence:
$$\text{Query Parameters} < \text{JSON Body} < \text{Path Parameters}$$

Path segments (e.g. `/orders/:id`) take absolute precedence. An attacker cannot inject or spoof an entity ID by providing a conflicting `id` in the query string or request body.

### 2. Stream-Bounded Body Parsing (`readBoundedJsonStream`)
Instead of trusting the `Content-Length` header (which can be omitted or spoofed via `Transfer-Encoding: chunked`), bodies are consumed chunk-by-chunk using a `ReadableStreamDefaultReader` with an accumulating byte counter:
- If cumulative bytes exceed `config.limits.maxBodyBytes`, the reader is immediately aborted with `reader.cancel('PAYLOAD_TOO_LARGE')` and throws HTTP 413 RFC 9457 Problem Details (`PAYLOAD_TOO_LARGE`).
- This guarantees memory overhead is strictly bounded ($O(1)$ chunk overhead), preventing chunked-stream Out-Of-Memory (OOM) DoS attacks.

### 3. Safe Primitive Coercion & Array Query Parameters
- **Leading-Zero Preservation:** Query parameters are inherently strings. Standard parsing converts `"42"` to number `42` and `"true"` to boolean `true`. However, strings matching `/^0\d+$/` (e.g. `"01234"`, `"007"`) are strictly preserved as strings, preventing data corruption on postal codes, identity numbers (NIK), or phone numbers.
- **Multi-Value Query Arrays:** Uses Hono's `c.req.queries()` to automatically normalize repeated query keys (e.g. `?tags=a&tags=b` or `?tags[]=x`) into typed arrays before schema validation.

### 4. Custom Content-Type Responses
Actions returning non-JSON payloads (such as raw CSV exports, SVG badges, or plain text) configure `action.http.customContentType`. Shukoi bypasses default JSON serialization and serves the payload with the exact requested `Content-Type` header:

```typescript
export const exportCsvAction = defineAction({
  name: 'exportCsv',
  http: {
    method: 'GET',
    path: '/api/v1/reports/export.csv',
    customContentType: 'text/csv; charset=utf-8',
  },
  async handler() {
    return 'id,name,amount\n1,Alpha,500\n2,Beta,1200';
  },
});
```

### 5. Idempotency Replay Indication
When a request bearing an `Idempotency-Key` header matches an existing completed execution in the idempotency store, Shukoi replays the cached payload and emits the standard `Idempotent-Replayed: true` HTTP response header.

---

## Automated OpenAPI 3.1.0 Specification Compilation

`@shukoi/api` automatically compiles living OpenAPI 3.1.0 specifications from frozen TypeBox schemas at `/openapi.json`:

```typescript
import { createRestRouter } from '@shukoi/api';
import { createDefaultConfig } from '@shukoi/core';
import { actions } from './actions/index.js';

const config = createDefaultConfig();
export const app = createRestRouter(actions, config);

// GET /openapi.json is automatically mounted and served!
```

### Key OpenAPI Compilation Capabilities:
- **Query Parameter Projection:** For `GET` and `DELETE` routes, schema properties in `action.input` that do not exist in the path are automatically projected into `parameters: [{ in: 'query', name, schema, required, description }]`.
- **Security Schemes:** Automatically defines root `components.securitySchemes` (`bearerAuth` and `apiKeyAuth`). Operations with `action.authRequired === true` automatically attach `security: [{ bearerAuth: [] }, { apiKeyAuth: [] }]`.
- **Root Servers:** Declares root `servers: [{ url: '/', description: 'Default Server' }]`.

---

## Universal RFC 9457 404 Problem Details

Unlike traditional frameworks that return plain text `404 Not Found`, unmapped routes are caught via Hono's `app.notFound()` handler and serialized into RFC 9457 Problem Details envelopes:

```json
{
  "type": "urn:shukoi:error:not-found",
  "title": "NOT FOUND",
  "status": 404,
  "detail": "No route mapped to GET /unknown-endpoint",
  "instance": "/unknown-endpoint",
  "code": "NOT_FOUND",
  "requestId": "req_01j7h..."
}
```
