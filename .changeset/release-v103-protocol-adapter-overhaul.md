---
"@shukoi/core": patch
"@shukoi/api": patch
"@shukoi/mcp": patch
"@shukoi/cloudflare": patch
"@shukoi/lambda": patch
"@shukoi/selfhost": patch
"create-shukoi": patch
---

Release v1.0.3: Protocol Module A (API), Protocol Module B (MCP), and Runtime Adapters Overhaul:
- **@shukoi/mcp**: Native support for MCP `resources/read` (static URIs & RFC 6570 templates), `prompts/get` with TypeBox argument introspection, multimodal `tools/call` blocks (Base64 images, raw strings), HTTP `DELETE` 204 session teardown, `Accept` negotiation, and sterile STDIO with sequential FIFO backpressure queue (`enqueueFrameWrite`).
- **@shukoi/api**: OpenAPI 3.1.0 auto-extraction of query parameters for `GET`/`DELETE`, root `components.securitySchemes` (`bearerAuth` and `apiKeyAuth`), root `servers: [{ url: '/' }]`, universal RFC 9457 404 Problem Details (`app.notFound()`), safe leading-zero numeric strings, multi-value array query parameters, `customContentType` egress, and `Idempotent-Replayed: true` headers.
- **@shukoi/core**: Added `InMemoryIdempotencyStore.get` inspection method for replay detection.
- **@shukoi/cloudflare**: Added `getCloudflareContext`, `waitUntil` background execution, and in-memory D1/KV testing doubles.
- **@shukoi/lambda**: Added `getLambdaContext`, dynamic deadline subtraction, API Gateway v1/v2 & ALB handling, cookies, and in-memory testing doubles.
- **@shukoi/selfhost**: Added `getSelfHostContext`, stream-bounded body parsing ($O(1)$ heap OOM HTTP 413 defense), Kubernetes `/healthz` probes, and Docker containerization.
- **create-shukoi**: Scaffolding templates and dependency synchronizer aligned with v1.0.3.
- **Documentation & Metadata**: Deployed VitePress documentation portal at `https://shukoilab.github.io/shukoi/` featuring interactive OpenAPI 3.1.0 visualizer (Scalar) and updated canonical `homepage` across all manifests.
