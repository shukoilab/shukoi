---
name: shukoi-deploy-target
description: Configures, builds, and deploys Shukoi applications to Cloudflare Workers (V8 Isolates), AWS Lambda (Node.js ESM), or Bun/Node self-hosted containers. Use whenever setting up entrypoints, serverless adapters, or graceful shutdown lifecycles.
compatibility: TypeScript 5.5+, Hono, @shukoi/core
---

# Deploying a Shukoi Application Across Target Runtimes

## Overview
Shukoi applications author business logic once inside declarative actions (`defineAction`). The application compiles into a standard Hono REST router and an MCP catalog. Deploying to any cloud or container target requires simply wrapping the Hono instance in a specialized runtime adapter:

```text
               1 Declarative Action Engine (@shukoi/core)
                                  │
          ┌───────────────────────┴───────────────────────┐
          ▼                                               ▼
     REST Router (@shukoi/api)                      MCP Catalog (@shukoi/mcp)
          │                                               │
          └───────────────────────┬───────────────────────┘
                                  ▼
                    3 Production Runtime Targets
   ┌──────────────────────────────┼──────────────────────────────┐
   ▼                              ▼                              ▼
Cloudflare Workers            AWS Lambda                    Self-Host Server
(@shukoi/cloudflare)       (@shukoi/lambda)               (@shukoi/selfhost)
 • V8 Edge Isolates         • Node.js 22+ ESM              • Bun 1.2+ / Node 22+
 • Pure Web Standard        • Dynamic Deadline Subtraction • OOM Bounded Ingress (413)
 • Sub-5ms Cold Starts      • API Gateway v1/v2 & ALB      • Kubernetes /healthz Probes
 • waitUntil Background     • Base64 Binary Auto-Encode    • Socket Drain Backpressure
 • D1 & KV In-Memory Mocks  • Lambda In-Memory Mocks       • Graceful Drain State Machine
```

---

## 1. Cloudflare Workers (`@shukoi/cloudflare`)

Adapts applications to Cloudflare Workers V8 isolates with zero `node:*` dependency leakage.

### Entrypoint (`src/entries/cloudflare.ts`)
```typescript
import { createRestRouter } from '@shukoi/api';
import { toCloudflareWorker } from '@shukoi/cloudflare';
import { actions } from '../actions/index.js';
import { config } from '../config.js';

const app = createRestRouter(actions, config);
export default toCloudflareWorker(app);
```

### Accessing Bindings in Actions (`getCloudflareContext`)
```typescript
import { defineAction } from '@shukoi/core';
import { getCloudflareContext } from '@shukoi/cloudflare';
import { Type } from '@sinclair/typebox';

interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
}

export const myAction = defineAction({
  name: 'myAction',
  input: Type.Object({ id: Type.String() }, { additionalProperties: false }),
  output: Type.Object({ name: Type.String() }, { additionalProperties: false }),
  async handler(input, ctx) {
    const { env, waitUntil } = getCloudflareContext<Env>(ctx);

    // 100% Type-Safe access to D1 and KV bindings:
    const user = await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(input.id).first<{ name: string }>();

    // Post-response background task execution via executionCtx.waitUntil:
    waitUntil(env.CACHE.put(`user:${input.id}`, JSON.stringify(user)));

    return user ?? { name: 'Anonymous' };
  },
});
```

### In-Memory Unit Testing (`@shukoi/cloudflare/testing`)
Test D1 queries and KV operations in Vitest in 1ms without Miniflare or Docker:
```typescript
import { describe, expect, it } from 'vitest';
import { createActionTestHarness } from '@shukoi/core/testing';
import { createMockD1, createMockKv } from '@shukoi/cloudflare/testing';
import { myAction } from '../src/actions/myAction.js';

describe('myAction', () => {
  it('reads D1 and caches in KV', async () => {
    const mockDb = createMockD1({ defaultRows: [{ name: 'Alice' }] });
    const mockCache = createMockKv();

    const harness = createActionTestHarness({
      platform: { env: { DB: mockDb, CACHE: mockCache }, waitUntil: (p) => void p },
    });

    const result = await harness.execute(myAction, { id: '1' });
    expect(result.name).toBe('Alice');
  });
});
```

### Configuration & CLI Workflows
- **`wrangler.jsonc`**: Official Cloudflare configuration with `"compatibility_flags": ["nodejs_compat"]` and `"observability": { "enabled": true }`.
- **`env.d.ts`**: TypeScript interface for bindings; run `pnpm run cf-typegen` (`wrangler types env.d.ts`) to synchronize.
- **Commands**: `pnpm run dev` (`wrangler dev`), `pnpm run deploy` (`wrangler deploy`).

---

## 2. AWS Lambda (`@shukoi/lambda`)

Adapts applications to AWS Lambda running on Node.js 22+ ESM, supporting API Gateway v1 (REST API), API Gateway v2 (HTTP API), Application Load Balancers (ALB), and Function URLs.

### Entrypoint (`src/entries/lambda.ts`)
```typescript
import { createRestRouter } from '@shukoi/api';
import { toLambdaHandler } from '@shukoi/lambda';
import { config } from '../config.js';
import { actions } from '../actions/index.js';

const app = createRestRouter(actions, config);
export const handler = toLambdaHandler(app, { config });
```

### Key Architectural Invariants & Resilience
1. **Dynamic Execution Deadline Subtraction:**
   $$\text{effectiveTimeoutMs} = \min(\text{defaultTimeoutMs}, \text{context.getRemainingTimeInMillis()} - \text{config.limits.lambdaDeadlineBufferMs})$$
   If remaining execution time is exhausted, the handler aborts immediately with HTTP 504 Gateway Timeout in RFC 9457 `application/problem+json` before starting database transactions.
2. **Container Freeze Safety:** Request signal aborts at `effectiveTimeoutMs` to ensure active database transactions roll back cleanly before AWS Firecracker microVM freeze.
3. **Full Cookie Normalization:** Reads `event.cookies` array on API Gateway v2 HTTP APIs and populates outgoing `result.cookies: string[]` via `res.headers.getSetCookie()`.
4. **Automatic Binary Encoding:** Auto-detects binary MIME types (`image/*`, `application/pdf`, `application/octet-stream`) via `defaultIsContentTypeBinary` and encodes responses as Base64 with `isBase64Encoded: true`.
5. **Stage & BasePath Normalization:** Automatically strips API Gateway v1 stage prefixes (`event.requestContext.stage`) and `options.basePath` to prevent 404 routing errors.

### Accessing Lambda Context in Actions (`getLambdaContext`)
```typescript
import { defineAction } from '@shukoi/core';
import { getLambdaContext } from '@shukoi/lambda';
import { Type } from '@sinclair/typebox';

export const orderAction = defineAction({
  name: 'orderAction',
  input: Type.Object({ orderId: Type.String() }, { additionalProperties: false }),
  output: Type.Object({ success: Type.Boolean(), awsRequestId: Type.String() }, { additionalProperties: false }),
  async handler(input, ctx) {
    const { context, getRemainingTimeInMillis } = getLambdaContext(ctx);

    ctx.logger.info(`Processing order ${input.orderId} (AWS Request ID: ${context.awsRequestId})`);
    ctx.logger.info(`Time budget remaining: ${getRemainingTimeInMillis()}ms`);

    return { success: true, awsRequestId: context.awsRequestId ?? 'unknown' };
  },
});
```

### In-Memory Unit Testing (`@shukoi/lambda/testing`)
Test Lambda events and context in Vitest without SAM CLI or Docker:
```typescript
import { describe, expect, it } from 'vitest';
import { createMockApiGatewayV2Event, createMockLambdaContext } from '@shukoi/lambda/testing';
import { handler } from '../src/entries/lambda.js';

describe('Lambda Handler', () => {
  it('handles API Gateway v2 event and returns parsed body', async () => {
    const mockContext = createMockLambdaContext({ awsRequestId: 'req-123', getRemainingTimeInMillis: () => 15000 });
    const mockEvent = createMockApiGatewayV2Event({
      rawPath: '/orders',
      httpMethod: 'POST',
      body: JSON.stringify({ orderId: 'ord-101' }),
      cookies: ['sessionId=abc123xyz'],
    });

    const result = await handler(mockEvent, mockContext);
    expect(result.statusCode).toBe(200);
  });
});
```

### Scaffolding & Bundling
- **`template.yaml`**: Turnkey AWS SAM template targeting Node.js 22, arm64 Graviton architecture, and HTTP API v2.
- **Commands**: `pnpm run build:lambda` (fast bundling via `esbuild`), `pnpm run dev` (`sam local start-api`), `pnpm run deploy` (`sam deploy --guided`).

---

## 3. Self-Host Server (`@shukoi/selfhost`)

Hosts Shukoi applications on standalone Node.js 22+ LTS or Bun 1.2+ servers with built-in Kubernetes health probes and graceful draining.

### Entrypoint (`src/entries/selfhost.ts`)
```typescript
import { createRestRouter } from '@shukoi/api';
import { createSelfHostServer } from '@shukoi/selfhost';
import { config } from '../config.js';
import { actions } from '../actions/index.js';

const app = createRestRouter(actions, config);
export const serverHandle = createSelfHostServer(app, config, {
  port: Number(process.env.PORT ?? 3000),
  host: '0.0.0.0',
  shutdownGracePeriodMs: 10000,
  isReady: async () => {
    // Dynamic readiness check (e.g. database pool / cache health)
    return true;
  },
  onShutdown: async () => {
    console.log('Releasing database pools and flushing telemetry...');
  },
});
```

### Key Architectural Invariants & Resilience
1. **Stream-Level Bounded Ingress (OOM Protection):** Reads incoming body chunks through an accumulating byte counter enforcing `config.limits.maxBodyBytes`. Rejects oversized bodies immediately with HTTP 413 RFC 9457 Problem Details (`PAYLOAD_TOO_LARGE`) without unbounded memory accumulation.
2. **Egress Multi-Cookie Preservation:** Uses `res.headers.getSetCookie()` to write an array of distinct `Set-Cookie` strings to `res.setHeader('set-cookie', cookies)`, eliminating comma-concatenation corruption.
3. **Socket Backpressure Handling:** Pauses stream reading when `res.write(value)` returns `false` until the TCP socket emits the `'drain'` event.
4. **Dynamic Kubernetes Health Probes:**
   - Liveness (`/healthz/live`): Returns HTTP 200 while process is alive.
   - Readiness (`/healthz/ready`): Returns HTTP 200 when `HEALTHY` and `isReady` hook passes; returns HTTP 503 when `DRAINING` or unready.
5. **Deterministic Graceful Drain State Machine:** Intercepts `SIGTERM` and `SIGINT`, flips state to `DRAINING` (503 on ready probe), drains in-flight requests up to `shutdownGracePeriodMs`, destroys dangling sockets, runs `onShutdown()`, and exits code 0.

### Accessing Client IP in Actions (`getSelfHostContext`)
```typescript
import { defineAction } from '@shukoi/core';
import { getSelfHostContext } from '@shukoi/selfhost';
import { Type } from '@sinclair/typebox';

export const statusAction = defineAction({
  name: 'statusAction',
  input: Type.Object({}, { additionalProperties: false }),
  output: Type.Object({ clientIp: Type.String(), serverState: Type.String() }, { additionalProperties: false }),
  async handler(_input, ctx) {
    const { remoteAddress, serverState } = getSelfHostContext(ctx);
    return { clientIp: remoteAddress ?? '127.0.0.1', serverState: serverState() };
  },
});
```

### In-Memory Unit Testing (`@shukoi/selfhost/testing`)
```typescript
import { createMockSelfHostContext } from '@shukoi/selfhost/testing';

const mockPlatform = createMockSelfHostContext({ remoteAddress: '203.0.113.195' });
expect(mockPlatform.remoteAddress).toBe('203.0.113.195');
expect(mockPlatform.serverState()).toBe('HEALTHY');
```

### Scaffolding & Containerization
- **`Dockerfile`**: Hardened multi-stage build (`node:22-alpine`, non-root user `USER node`, frozen lockfile).
- **`.dockerignore`**: Blocks `.env`, `.git`, `.agent`, `node_modules`, and test artifacts.
- **Commands**: `pnpm run dev` (`node --watch src/entries/selfhost.ts`), `pnpm run start` (`node dist/entries/selfhost.js`), `docker build -t my-service .`.

---

For complete runtime capability comparisons, read [references/runtime-matrix.md](references/runtime-matrix.md).
