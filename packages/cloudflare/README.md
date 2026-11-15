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

### 2. Wrangler Configuration (`wrangler.toml`)

```toml
name = "my-shukoi-worker"
main = "dist/entries/cloudflare.js"
compatibility_date = "2024-11-01"

[vars]
SHUKOI_SERVICE_NAME = "my-edge-service"

# Optional Cloudflare D1 / KV / R2 bindings
# [[kv_namespaces]]
# binding = "CACHE"
# id = "..."
```

---

## API Reference

### `toCloudflareWorker(app)`

Wraps a Hono application instance into a standard Cloudflare Worker module export:

```typescript
export interface CloudflareWorkerExport {
  fetch(
    request: Request,
    env: Record<string, unknown>,
    executionCtx: CloudflareExecutionContext,
  ): Promise<Response>;
}
```

---

## License

MIT © [Shukoi Contributors](https://github.com/shukoilab/shukoi)
