# Shukoi Target Runtime Comparison Matrix

This reference provides an exhaustive, enterprise-grade comparison of all three supported deployment runtimes across the Shukoi monorepo ecosystem.

---

## 1. Core Architectural Capabilities

| Architectural Dimension | Cloudflare Workers (`@shukoi/cloudflare`) | AWS Lambda (`@shukoi/lambda`) | Self-Host Server (`@shukoi/selfhost`) |
| :--- | :--- | :--- | :--- |
| **Primary Execution Engine** | V8 Edge Isolates | AWS Lambda microVM (Firecracker) | Standalone Node.js 22+ / Bun 1.2+ daemon |
| **Node.js Built-ins (`node:*`)** | **FORBIDDEN (0 `node:*` imports)** | Permitted (Node.js 22+ ESM) | Permitted (Node.js 22+ / Bun 1.2+) |
| **Cold Start Latency** | Sub-5ms | ~150ms (Node.js ESM) | 0ms (Daemon already listening) |
| **Maximum Execution Window** | 30s CPU time (unbound wall-clock) | 15 minutes (configured in SAM) | Configurable / Indefinite |
| **Typed Platform Accessor** | `getCloudflareContext<TEnv>(ctx)` | `getLambdaContext<TEvent, TContext>(ctx)` | `getSelfHostContext(ctx)` |
| **Platform Context Properties** | `env` (D1, KV, R2), `waitUntil`, `executionCtx` | `context` (`awsRequestId`, remaining time), `event` | `remoteAddress`, `remotePort`, `incoming`, `outgoing`, `serverState` |

---

## 2. Ingress & Egress Data Handling

| Data Handling Dimension | Cloudflare Workers (`@shukoi/cloudflare`) | AWS Lambda (`@shukoi/lambda`) | Self-Host Server (`@shukoi/selfhost`) |
| :--- | :--- | :--- | :--- |
| **Ingress Cookie Parsing** | Web-standard `Cookie` request header | API Gateway v2 `event.cookies` array normalized into `Cookie` header | Standard Node.js `Cookie` request header |
| **Egress Cookie Preservation** | Multi-value `Set-Cookie` headers | Multi-cookie array on `result.cookies: string[]` via `res.headers.getSetCookie()` | Multi-cookie array on `res.setHeader('set-cookie', cookies)` |
| **Binary Response Handling** | Native Web-standard `Response` | Auto-detected via `defaultIsContentTypeBinary`, Base64-encoded with `isBase64Encoded: true` | Web-standard stream piping with TCP socket `drain` backpressure |
| **Body Size / OOM Defense** | 128 MB edge platform limit | 6 MB payload limit (API Gateway payload format) | Enforces `config.limits.maxBodyBytes` via streaming byte counter; returns HTTP 413 |
| **Routing & Prefix Stripping** | Direct root pathname routing | Automatic stripping of `options.basePath` and API Gateway v1 `requestContext.stage` | Normalizes path from `req.url` with host header resolution |

---

## 3. Concurrency, Teardown & Lifecycle

| Lifecycle Dimension | Cloudflare Workers (`@shukoi/cloudflare`) | AWS Lambda (`@shukoi/lambda`) | Self-Host Server (`@shukoi/selfhost`) |
| :--- | :--- | :--- | :--- |
| **Post-Response Background Tasks** | `executionCtx.waitUntil(promise)` | N/A (runtime frozen upon response) | Asynchronous tasks with process draining |
| **Early Timeout & Deadline** | Cloudflare wall-clock limit | Dynamic deadline calculation: $\min(T_{\text{action}}, T_{\text{remaining}} - T_{\text{buffer}})$; returns RFC 9457 504 | Server-side request abort controller via `ctx.signal` |
| **Container Freeze / Rollback** | Immediate worker hibernation | Aborts `ctx.signal` at deadline, rolling back database transactions before container freeze | Drains active in-flight requests up to `shutdownGracePeriodMs` |
| **Container Health Probes** | Edge health managed by Cloudflare | AWS ALB / Route53 health checks | Built-in `/healthz/live` (200) and `/healthz/ready` (200/503) with dynamic `isReady` hook |
| **Process Signal Handling** | Managed by Cloudflare runtime | Managed by AWS Lambda runtime | Traps `SIGTERM` and `SIGINT`, destroys keep-alive sockets, runs `onShutdown()` hook |

---

## 4. Testing Doubles & Tooling Scaffolding

| Tooling Dimension | Cloudflare Workers (`@shukoi/cloudflare`) | AWS Lambda (`@shukoi/lambda`) | Self-Host Server (`@shukoi/selfhost`) |
| :--- | :--- | :--- | :--- |
| **In-Memory Testing Subpath** | `@shukoi/cloudflare/testing` | `@shukoi/lambda/testing` | `@shukoi/selfhost/testing` |
| **Testing Doubles Provided** | `createMockKv(seed?)`, `createMockD1(options?)` | `createMockLambdaContext()`, `createMockApiGatewayV2Event()`, `createMockApiGatewayV1Event()` | `createMockSelfHostContext()` |
| **Test Execution Speed** | Sub-millisecond (zero Miniflare) | Sub-millisecond (zero SAM CLI) | Sub-millisecond (zero live OS sockets) |
| **Turnkey Scaffolding Manifest** | `wrangler.jsonc` + `env.d.ts` | AWS SAM `template.yaml` | Multi-stage non-root `Dockerfile` + `.dockerignore` |
| **Local Dev CLI Workflow** | `pnpm run dev` (`wrangler dev`) | `pnpm run dev` (`sam local start-api`) | `pnpm run dev` (`node --watch src/entries/selfhost.ts`) |
| **Production Build Command** | `pnpm run build` (`tsc`) | `pnpm run build:lambda` (`esbuild`) | `pnpm run build` (`tsc`) + `docker build` |
