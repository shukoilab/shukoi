# Self-Host Server Adapter (`@shukoi/selfhost`)

`@shukoi/selfhost` powers long-running servers and microservices running on **Node.js 22+ LTS** or **Bun 1.2+** with enterprise-grade connection draining and container health probes.

---

## Architectural Highlights

- **Stream-Level Bounded Ingress (OOM Defense):** Enforces `config.limits.maxBodyBytes` by consuming incoming request body chunks through an accumulating byte counter. Rejects oversized requests immediately with RFC 9457 HTTP 413 Problem Details (`PAYLOAD_TOO_LARGE`) and destroys the stream, bounding memory overhead to a single chunk ($O(1)$ heap overhead).
- **Graceful Drain State Machine:** Traps POSIX signals (`SIGTERM`, `SIGINT`) to execute a 4-phase zero-downtime shutdown sequence:
  $$\text{RUNNING} \longrightarrow \text{DRAINING} \longrightarrow \text{TERMINATING} \longrightarrow \text{STOPPED}$$
- **Kubernetes Probes:** Built-in `/healthz` (liveness) and `/healthz/ready` (readiness) endpoints. During shutdown draining, readiness probes immediately return HTTP 503 (`Service Unavailable`), instructing Kubernetes or AWS ALB to stop routing new traffic while in-flight requests finish cleanly.
- **Typed Platform Context:** Exposes `getSelfHostContext(ctx)` returning `{ remoteAddress, remotePort, serverState }`.
- **In-Memory Testing Doubles (`@shukoi/selfhost/testing`):** Exports `createMockSelfHostContext` for testing client IP, port, and server state in Vitest without binding live OS network sockets.

---

## Entrypoint Implementation (`src/entries/selfhost.ts`)

```typescript
import { createRestRouter } from '@shukoi/api';
import { startServer, getSelfHostContext } from '@shukoi/selfhost';
import { createDefaultConfig } from '@shukoi/core';
import { actions } from '../actions/index.js';

const config = createDefaultConfig({
  limits: {
    maxBodyBytes: 10 * 1024 * 1024, // 10 MB ceiling
  },
});

const app = createRestRouter(actions, config);

// Launch server with graceful draining and probe routes
export const server = await startServer(app, config, {
  port: Number(process.env.PORT) || 3000,
  host: '0.0.0.0',
  drainTimeoutMs: 15000, // 15 seconds to drain active requests on SIGTERM
});
```

---

## Accessing Client IP & Server State

```typescript
import { getSelfHostContext } from '@shukoi/selfhost';

export const whoamiAction = defineAction({
  name: 'whoami',
  http: { method: 'GET', path: '/api/v1/whoami' },
  async handler(input, ctx) {
    const platform = getSelfHostContext(ctx);
    
    return {
      clientIp: platform?.remoteAddress ?? '127.0.0.1',
      clientPort: platform?.remotePort,
      serverState: platform?.serverState() ?? 'HEALTHY',
    };
  },
});
```

---

## Production Docker Hardening

Scaffolded projects include a hardened multi-stage `Dockerfile`:

```dockerfile
# Multi-stage minimal production image
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=builder /app/dist ./dist

# Non-root secure user
USER node
EXPOSE 3000
CMD ["node", "dist/entries/selfhost.js"]
```
