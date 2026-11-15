# Shukoi Target Runtime Comparison Matrix

| Runtime Target | Package Adapter | Node Modules Permitted | Cold Start | Max Request Timeout | Key Integration Hooks |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Cloudflare Workers** | `@shukoi/cloudflare` | **NO (`node:*` forbidden)** | Sub-5ms | 30s (unbound CPU) | `ctx.platform.env` (D1, KV, R2), `executionCtx.waitUntil` |
| **AWS Lambda** | `@shukoi/lambda` | Yes (Node.js 22+ ESM) | ~150ms | 15 minutes | Dynamic deadline calculation (`lambdaDeadlineBufferMs`), API Gateway v1/v2 |
| **Self-Host (Bun/Node)** | `@shukoi/selfhost` | Yes (Bun 1.2+ / Node 22+) | 0ms (daemon) | Configurable | `/healthz/live`, `/healthz/ready` (503 drain), SIGTERM socket drain |
