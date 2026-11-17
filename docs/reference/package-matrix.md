# Scoped NPM Package Matrix

All official packages in the `@shukoi/*` namespace adhere to strict architectural boundaries:

| Package Name | Purpose | Node.js Built-ins | Target Runtime | Primary Exports |
| :--- | :--- | :--- | :--- | :--- |
| **`@shukoi/core`** | Universal Action Engine, Adaptive Validator, Single-Flight Auth, Sterile Logger, Testing Double Harness | **Forbidden** (Pure Web Standard) | All Runtimes | `defineAction`, `executeAction`, `DomainError`, `createDefaultConfig`, `compileValidator` |
| **`@shukoi/api`** | Protocol Module A: Hono REST Router, Stream-Bounded Ingress (413), OpenAPI 3.1.0 Generator, Universal RFC 9457 Problem Details | **Forbidden** (Pure Web Standard) | All Runtimes | `createRestRouter`, `generateOpenApiSpec`, `readBoundedJsonStream`, `coercePrimitiveParam` |
| **`@shukoi/mcp`** | Protocol Module B: Streamable HTTP (`./http`) & Sterile STDIO (`./stdio`) MCP Transports for Tools, Resources, and Prompts | Allowed only in `./stdio` | Edge & Node/Bun | `compileMcpCatalog`, `createScopedMcpServer`, `mountMcpHttpRoutes`, `startStdioServer` |
| **`@shukoi/cloudflare`** | Cloudflare Workers V8 Isolate Adapter with `getCloudflareContext`, `waitUntil`, and in-memory D1/KV mocks (`./testing`) | **Forbidden** (Pure Web Standard) | Cloudflare Workers | `toCloudflareWorker`, `getCloudflareContext`, `createMockCloudflareContext` |
| **`@shukoi/lambda`** | AWS Lambda Adapter with dynamic deadline subtraction, API Gateway v1/v2 & ALB handling, cookies, and in-memory mocks (`./testing`) | Permitted | AWS Lambda | `toLambdaHandler`, `getLambdaContext`, `createMockLambdaContext` |
| **`@shukoi/selfhost`** | Long-running Bun and Node server with OOM 413 defense, Graceful Drain State Machine, Kubernetes `/healthz` probes, and in-memory mocks (`./testing`) | Permitted | Bun 1.2+ / Node 22+ | `startServer`, `getSelfHostContext`, `createMockSelfHostContext` |
| **`@shukoi/store-redis`** | Distributed Redis Idempotency Store with atomic Lua scripts, dual runtime (`./node` and `./edge`), and in-memory mocks (`./testing`) | Allowed only in `./node` (Edge is pure Web fetch) | Node/Bun & Cloudflare Workers | `createRedisIdempotencyStore`, `RedisIdempotencyStore`, `UpstashRedisClient` |
| **`@shukoi/ratelimit`** | Universal Distributed Rate Limiter (Sliding Window & Token Bucket) with bounded LRU memory protection, IETF headers, and in-memory mocks (`./testing`) | **Forbidden** (Pure Web Standard) | All Runtimes | `createRateLimiter`, `slidingWindow`, `tokenBucket`, `BoundedLruCache` |
| **`create-shukoi`** | Interactive and CI project scaffolder CLI | Permitted | Local CLI | `createShukoiProject` |
