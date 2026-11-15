# @shukoi/selfhost

> **Standalone Bun 1.2+ & Node.js 22+ HTTP Server with Graceful Draining for Shukoi Applications**

[![npm version](https://img.shields.io/npm/v/@shukoi/selfhost.svg)](https://www.npmjs.com/package/@shukoi/selfhost)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`@shukoi/selfhost` hosts Shukoi applications on long-running containerized servers using Bun 1.2+ or Node.js 22+ LTS. It includes built-in Kubernetes container lifecycle probes (`/healthz/live`, `/healthz/ready`) and a deterministic Graceful Shutdown State Machine that prevents dropped requests during container restarts and rolling deployments.

---

## Key Features & Invariants

- **Built-in Container Probes:**
  - `/healthz/live`: Returns HTTP 200 while the process daemon is alive.
  - `/healthz/ready`: Returns HTTP 200 when `HEALTHY`, and flips to HTTP 503 immediately when `DRAINING`.
- **Graceful Shutdown State Machine:**
  - Intercepts POSIX `SIGTERM` and `SIGINT` signals.
  - Flips state to `DRAINING` (readiness probe returns 503 so load balancers divert new ingress traffic).
  - Awaits active in-flight requests up to `shutdownGracePeriodMs`.
  - Aborts any remaining active requests on deadline expiration.
  - Closes socket listener, destroys dangling keep-alive TCP connections, and executes registered `onShutdown()` teardown callbacks (e.g. database pool disconnection).
- **Dual Runtime Support:** Operates seamlessly across Bun (`Bun.serve`) and Node.js (`node:http` or `@hono/node-server`).

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

// Start server with 10-second graceful drain window
export const serverHandle = createSelfHostServer(app, config, {
  port: Number(process.env.PORT ?? 3000),
  host: '0.0.0.0',
  shutdownGracePeriodMs: 10000,
  onShutdown: async () => {
    console.log('Draining database pools and releasing cache handles...');
  },
});
```

### 2. Multi-Stage Dockerfile Recipe

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g pnpm
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/dist ./dist
RUN pnpm install --prod --frozen-lockfile
EXPOSE 3000
CMD ["node", "dist/entries/selfhost.js"]
```

---

## API Reference

### `createSelfHostServer(app, config, options?)`

Starts a self-hosted HTTP server returning a control handle:

```typescript
export interface SelfHostServerHandle {
  readonly getState: () => ServerHealthState; // 'STARTING' | 'HEALTHY' | 'DRAINING' | 'TERMINATED'
  readonly getActiveRequestCount: () => number;
  readonly stop: () => Promise<void>;
  readonly server: http.Server;
}
```

---

## License

MIT © [Shukoi Contributors](https://github.com/shukoilab/shukoi)
