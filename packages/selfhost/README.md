# @shukoi/selfhost

> **Standalone Bun 1.2+ & Node.js 22+ HTTP Server with Graceful Draining, OOM Defense, and Typed Context for Shukoi Applications**

[![npm version](https://img.shields.io/npm/v/@shukoi/selfhost.svg)](https://www.npmjs.com/package/@shukoi/selfhost)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`@shukoi/selfhost` hosts Shukoi applications on long-running containerized servers using Bun 1.2+ or Node.js 22+ LTS. It includes built-in Kubernetes container lifecycle probes (`/healthz/live`, `/healthz/ready`), stream-level bounded body reading (OOM defense with HTTP 413), typed client platform context (`getSelfHostContext`), multi-cookie preservation, and a deterministic Graceful Shutdown State Machine that prevents dropped requests during container restarts and rolling deployments.

---

## Key Features & Invariants

- **Built-in Container Probes & Dynamic Readiness:**
  - `/healthz/live`: Returns HTTP 200 while the process daemon is alive.
  - `/healthz/ready`: Returns HTTP 200 when `HEALTHY` and optional `isReady` hook passes; flips to HTTP 503 immediately when `DRAINING` or unready.
  - Customizable probe paths via `options.livenessPath` and `options.readinessPath`.
- **Stream-Level Bounded Ingress (OOM Protection):**
  - Reads request bodies through a streaming byte counter strictly enforcing `config.limits.maxBodyBytes`.
  - Rejects oversized requests immediately with RFC 9457 HTTP 413 Problem Details without unbounded memory accumulation.
- **Typed Platform Context (`getSelfHostContext`):**
  - Access client IP (`remoteAddress`), port (`remotePort`), and server lifecycle state directly inside action handlers without type-casting.
- **Full Egress Cookie Preservation:**
  - Emits multiple distinct `Set-Cookie` HTTP headers using Web-standard `getSetCookie()` array extraction, eliminating comma-concatenation corruption.
- **Socket Backpressure Handling:**
  - Respects TCP socket drain events during response streaming, preventing high memory buffer bloat on slow connections.
- **Graceful Shutdown State Machine:**
  - Intercepts POSIX `SIGTERM` and `SIGINT` signals.
  - Flips state to `DRAINING` (readiness probe returns 503 so load balancers divert new ingress traffic).
  - Awaits active in-flight requests up to `shutdownGracePeriodMs`.
  - Aborts any remaining active requests on deadline expiration.
  - Closes socket listener, destroys dangling keep-alive TCP connections, and executes registered `onShutdown()` teardown callbacks (e.g. database pool disconnection).
- **In-Memory Testing Doubles (`@shukoi/selfhost/testing`):**
  - Mock client IP, port, and server state in Vitest in 1ms without binding live OS network ports.

---

## Installation

```bash
pnpm add @shukoi/selfhost @shukoi/api @shukoi/core hono
# or
npm install @shukoi/selfhost @shukoi/api @shukoi/core hono
# or
bun add @shukoi/selfhost @shukoi/api @shukoi/core hono
```

---

## Usage

### 1. Server Entrypoint (`src/entries/selfhost.ts`)

```typescript
import { createRestRouter } from '@shukoi/api';
import { createSelfHostServer } from '@shukoi/selfhost';
import { createDefaultConfig } from '@shukoi/core';
import { myAction } from '../actions/myAction.js';

const config = createDefaultConfig();
const app = createRestRouter([myAction], config);

// Start server with 10-second graceful drain window and custom database readiness probe
export const serverHandle = createSelfHostServer(app, config, {
  port: Number(process.env.PORT ?? 3000),
  host: '0.0.0.0',
  shutdownGracePeriodMs: 10000,
  isReady: async () => {
    // Check database connection pool or cache
    return true;
  },
  onShutdown: async () => {
    console.log('Draining database pools and releasing cache handles...');
  },
});
```

### 2. Accessing Client IP in Actions (`getSelfHostContext`)

```typescript
import { defineAction } from '@shukoi/core';
import { getSelfHostContext } from '@shukoi/selfhost';
import { Type } from '@sinclair/typebox';

export const loginAction = defineAction({
  name: 'loginAction',
  input: Type.Object({ username: Type.String() }),
  output: Type.Object({ success: Type.Boolean(), clientIp: Type.String() }),
  async handler(input, ctx) {
    // 100% Type-Safe access to client IP, port, and server state
    const { remoteAddress, serverState } = getSelfHostContext(ctx);

    ctx.logger.info(`Login attempt for ${input.username} from IP ${remoteAddress}`);
    ctx.logger.info(`Current server state: ${serverState()}`);

    return {
      success: true,
      clientIp: remoteAddress ?? '127.0.0.1',
    };
  },
});
```

### 3. In-Memory Testing (`@shukoi/selfhost/testing`)

```typescript
import { describe, expect, it } from 'vitest';
import { createActionTestHarness } from '@shukoi/core/testing';
import { createMockSelfHostContext } from '@shukoi/selfhost/testing';
import { loginAction } from '../src/actions/login.js';

describe('Login Action', () => {
  it('reads client IP from mock selfhost context', async () => {
    const mockPlatform = createMockSelfHostContext({
      remoteAddress: '203.0.113.195',
    });

    const harness = createActionTestHarness({
      platform: mockPlatform,
    });

    const result = await harness.execute(loginAction, { username: 'alice' });
    expect(result.clientIp).toBe('203.0.113.195');
  });
});
```

### 4. Production Multi-Stage Dockerfile

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g pnpm
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/dist ./dist
RUN pnpm install --prod --frozen-lockfile
USER node
EXPOSE 3000
CMD ["node", "dist/entries/selfhost.js"]
```

---

## API Reference

### `createSelfHostServer(app, config, options?)`

Starts a self-hosted HTTP server with graceful draining and health probes:

```typescript
export function createSelfHostServer(
  app: Hono,
  config: ShukoiConfig,
  options?: SelfHostOptions,
): SelfHostServerHandle;
```

### `getSelfHostContext(ctx)`

Extracts strongly-typed self-host platform container (`remoteAddress`, `remotePort`, `serverState`) from `ActionExecutionContext`.

### `@shukoi/selfhost/testing`

- `createMockSelfHostContext(overrides?)`: In-memory `SelfHostPlatform` test double.

---

## Related Documentation & Architecture

- **System Architecture:** [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) (Deep dive into graceful drain state machines and OOM defense).
- **Deployment Skill:** [skills/shukoi-deploy-target](../../skills/shukoi-deploy-target/SKILL.md) (Step-by-step deployment and operational guidance).
- **Runtime Comparison Matrix:** [Runtime Matrix](../../skills/shukoi-deploy-target/references/runtime-matrix.md) (Capabilities across Cloudflare, Lambda, and Self-Host).

---

## License

MIT © [Shukoi Contributors](https://github.com/shukoilab/shukoi)
