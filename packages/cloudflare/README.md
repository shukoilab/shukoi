# @shukoi/cloudflare

> **Cloudflare Workers (V8 Isolates) Runtime Adapter for Shukoi Applications**

[![npm version](https://img.shields.io/npm/v/@shukoi/cloudflare.svg)](https://www.npmjs.com/package/@shukoi/cloudflare)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Pure Web Standard](https://img.shields.io/badge/Runtime-V8_Isolates-success.svg)](https://github.com/shukoilab/shukoi)

`@shukoi/cloudflare` adapts Shukoi Hono applications to Cloudflare Workers edge runtimes. It operates entirely within V8 Isolate constraints without requiring Node.js compatibility flags, seamlessly bridges Cloudflare environment bindings (D1, KV, R2, Queues), and connects `executionCtx.waitUntil` for post-response background task execution.

---

## Key Features & Invariants

- **Pure Web-Standard Implementation:** Contains zero `node:*` imports or native C++ addons, guaranteeing compliance with Cloudflare's strict edge isolate runtime.
- **Sub-5ms Cold Starts:** Zero bundling overhead and lightweight AST-fallback validation deliver instantaneous edge execution.
- **Platform Environment Injection:** Injects Cloudflare Workers `env` directly into `ctx.platform.env` across all action executions.
- **`executionCtx.waitUntil` Integration:** Bridges asynchronous `ctx.onFinally()` hooks and telemetry directly to `executionCtx.waitUntil(...)`, allowing responses to be returned to clients immediately while locks and audit logs complete in the background.

---

## Installation

```bash
pnpm add @shukoi/cloudflare @shukoi/api @shukoi/core hono
# or
npm install @shukoi/cloudflare @shukoi/api @shukoi/core hono
# or
bun add @shukoi/cloudflare @shukoi/api @shukoi/core hono
```

---

## Usage

### 1. Worker Entrypoint (`src/entries/cloudflare.ts`)

```typescript
import { createRestRouter } from '@shukoi/api';
import { toCloudflareWorker } from '@shukoi/cloudflare';
import { createDefaultConfig } from '@shukoi/core';
import { myAction } from '../actions/myAction.js';

const config = createDefaultConfig();
const app = createRestRouter([myAction], config);

// Exports default object with { fetch(request, env, executionCtx) }
export default toCloudflareWorker(app);
```

### 2. Wrangler Configuration (`wrangler.jsonc`)

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "my-shukoi-worker",
  "main": "src/entries/cloudflare.ts",
  "compatibility_date": "2026-11-15",
  "compatibility_flags": ["nodejs_compat"],
  "observability": {
    "enabled": true
  }
  // Optional Cloudflare D1 / KV / R2 bindings
  // "kv_namespaces": [{ "binding": "CACHE", "id": "..." }],
  // "d1_databases": [{ "binding": "DB", "database_name": "db", "database_id": "..." }]
}
```

### 3. Accessing Bindings in Actions (`getCloudflareContext`)

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
  input: Type.Object({ id: Type.String() }),
  output: Type.Object({ name: Type.String() }),
  async handler(input, ctx) {
    const { env, waitUntil } = getCloudflareContext<Env>(ctx);

    // 100% Type-Safe access to D1 and KV:
    const user = await env.DB.prepare('SELECT name FROM users WHERE id = ?')
      .bind(input.id)
      .first<{ name: string }>();

    // Background task via executionCtx.waitUntil:
    waitUntil(env.CACHE.put(`user:${input.id}`, JSON.stringify(user)));

    return user ?? { name: 'Anonymous' };
  },
});
```

### 4. Lightning-Fast Unit Testing (`@shukoi/cloudflare/testing`)

Test actions with in-memory KV and D1 test doubles in Vitest without Miniflare or Docker:

```typescript
import { createActionTestHarness } from '@shukoi/core/testing';
import { createMockD1, createMockKv } from '@shukoi/cloudflare/testing';
import { describe, expect, it } from 'vitest';
import { myAction } from '../src/actions/myAction.js';

describe('myAction', () => {
  it('reads from D1 and writes to KV cache', async () => {
    const mockDb = createMockD1({ defaultRows: [{ name: 'Alice' }] });
    const mockCache = createMockKv();

    const harness = createActionTestHarness({
      platform: {
        env: { DB: mockDb, CACHE: mockCache },
        waitUntil: (p) => void p,
      },
    });

    const result = await harness.execute(myAction, { id: '1' });
    expect(result.name).toBe('Alice');
  });
});
```

---

## API Reference

### `toCloudflareWorker(app)`

Wraps a Hono application instance into a standard Cloudflare Worker module export.

### `getCloudflareContext<TEnv>(ctx)`

Extracts strongly-typed Cloudflare Workers bindings (`env`) and lifecycle helpers (`waitUntil`) from `ActionExecutionContext`.

### `@shukoi/cloudflare/testing`

- `createMockKv(initialData?)`: In-memory `KVNamespace` test double.
- `createMockD1(options?)`: In-memory `D1Database` test double supporting `.prepare()`, `.bind()`, `.first()`, `.all()`, and `.run()`.

---

## Related Documentation & Architecture

- **System Architecture:** [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) (Deep dive into V8 Isolate boundaries and runtime topologies).
- **Deployment Skill:** [skills/shukoi-deploy-target](../../skills/shukoi-deploy-target/SKILL.md) (Step-by-step deployment and operational guidance).
- **Runtime Comparison Matrix:** [Runtime Matrix](../../skills/shukoi-deploy-target/references/runtime-matrix.md) (Capabilities across Cloudflare, Lambda, and Self-Host).

---

## License

MIT © [Shukoi Contributors](https://github.com/shukoilab/shukoi)
