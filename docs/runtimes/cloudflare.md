# Cloudflare Workers Adapter (`@shukoi/cloudflare`)

`@shukoi/cloudflare` adapts Shukoi applications to Cloudflare Workers V8 edge isolates with zero `node:*` dependency leakage.

---

## Architectural Highlights

- **Pure Web-Standard Engine:** Guaranteed zero imports from `node:*` built-ins.
- **Typed Platform Context:** Exposes `getCloudflareContext(ctx)` to access native Cloudflare bindings (`env.DB`, `env.KV`, `env.AI`).
- **Edge Background Tasks (`waitUntil`):** Safe non-blocking execution using `waitUntil` to flush telemetry, metrics, or cache updates after the response is sent.
- **Isolate-Safe Adaptive Validation (ADR-001):** The TypeBox validator automatically detects that `new Function` is disabled in Workers isolates and falls back to AST interpretation without runtime errors.
- **In-Memory Testing Doubles (`@shukoi/cloudflare/testing`):** Mock D1 Database and KV Namespace for instantaneous Vitest unit tests without Miniflare or network overhead.

---

## Entrypoint Implementation (`src/entries/cloudflare.ts`)

```typescript
import { createRestRouter } from '@shukoi/api';
import { toCloudflareWorker, getCloudflareContext } from '@shukoi/cloudflare';
import { createDefaultConfig } from '@shukoi/core';
import { actions } from '../actions/index.js';

interface Env {
  DB: D1Database;
  CACHE_KV: KVNamespace;
  API_SECRET: string;
}

const config = createDefaultConfig();
const app = createRestRouter(actions, config);

// Export standard Cloudflare Workers fetch handler
export default toCloudflareWorker<Env>(app, {
  injectServices: (env, executionCtx) => ({
    db: env.DB,
    kv: env.CACHE_KV,
  }),
});
```

---

## Using `waitUntil` in Actions

```typescript
export const recordAnalyticsAction = defineAction({
  name: 'recordAnalytics',
  http: { method: 'POST', path: '/api/v1/analytics' },
  async handler(input, ctx) {
    const cf = getCloudflareContext(ctx);
    
    // Background task executed after HTTP response completes
    cf?.waitUntil(
      fetch('https://telemetry.internal/event', {
        method: 'POST',
        body: JSON.stringify({ event: input }),
      })
    );

    return { received: true };
  },
});
```

---

## Configuration (`wrangler.jsonc`)

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "my-shukoi-edge-service",
  "main": "src/entries/cloudflare.ts",
  "compatibility_date": "2026-11-17",
  "compatibility_flags": ["nodejs_compat_v2"]
}
```

---

## In-Memory Testing (`@shukoi/cloudflare/testing`)

```typescript
import { describe, it, expect } from 'vitest';
import { createMockCloudflareContext, createMockD1Database } from '@shukoi/cloudflare/testing';

describe('Edge Action Testing', () => {
  it('executes queries against mock D1 database', async () => {
    const mockD1 = createMockD1Database();
    const mockContext = createMockCloudflareContext({
      env: { DB: mockD1 },
    });

    expect(mockContext.env.DB).toBeDefined();
  });
});
```
