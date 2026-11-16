---
"@shukoi/core": patch
"@shukoi/api": patch
"@shukoi/mcp": patch
"@shukoi/cloudflare": patch
"@shukoi/lambda": patch
"@shukoi/selfhost": patch
"create-shukoi": patch
---

Release v1.0.3: Protocol Module A (API), Protocol Module B (MCP), and Runtime Adapters Overhaul.

### Protocol Module B (@shukoi/mcp)
- **Native Resources Protocol**: Added full support for `resources/list`, `resources/templates/list`, and `resources/read`. Supports static URIs (`resource://${name}`) and parameterized RFC 6570 URI templates (e.g. `cluster://{clusterId}/nodes/{nodeId}`) with regex route compilation and parameter extraction.
- **Native Prompts Protocol**: Added `prompts/list` and `prompts/get` with automatic argument schema introspection from TypeBox input schemas (`name`, `description`, `required`), returning standard MCP `messages: [{ role, content }]`.
- **Multimodal & Flexible Tools**: Normalized `tools/call` output handling plain JSON objects, raw text strings, and pre-formatted multimodal content blocks (e.g. Base64 images).
- **Stateless HTTP Transport**: Implemented HTTP `DELETE /mcp` returning 204 No Content for clean client session disconnection, and negotiated `Accept: application/json, text/event-stream`.
- **Sterile STDIO Serialization**: Configured pure stdin readline and sequential FIFO outbound frame queue (`enqueueFrameWrite`) with socket drain backpressure handling.

### Protocol Module A (@shukoi/api)
- **OpenAPI 3.1.0 Enhancements**: Automatic query parameter extraction for `GET` and `DELETE` routes, root `components.securitySchemes` (`bearerAuth` and `apiKeyAuth`), per-operation security requirements on authenticated actions, and root `servers: [{ url: '/' }]`.
- **Universal RFC 9457 Problem Details**: Added `app.notFound()` handler serializing unmapped routes into `application/problem+json` envelopes (`NOT_FOUND`, 404).
- **Input Coercion & Query Handling**: Safe primitive coercion strictly preserving leading-zero numeric strings (`"01234"`, `"007"`), and multi-value query array parameter parsing via `c.req.queries()`.
- **Response Headers**: Added `customContentType` egress support for non-JSON payloads, and emitted standard `Idempotent-Replayed: true` headers on cached executions.

### Core Framework (@shukoi/core)
- **Idempotency Store**: Added inspection method `InMemoryIdempotencyStore.get` and optional interface contract `IdempotencyStore.get?` for cached execution replay detection.

### Runtime Adapters & Edge-to-Cloud Deployments
- **Cloudflare Workers (@shukoi/cloudflare)**: Added `getCloudflareContext`, `waitUntil` lifecycle execution, and in-memory D1/KV testing doubles (`@shukoi/cloudflare/testing`).
- **AWS Lambda (@shukoi/lambda)**: Added `getLambdaContext`, dynamic deadline subtraction, API Gateway v1/v2 & ALB handling, cookies, and in-memory testing doubles (`@shukoi/lambda/testing`).
- **Self-Host Server (@shukoi/selfhost)**: Added `getSelfHostContext`, stream-bounded body parsing ($O(1)$ heap OOM HTTP 413 defense), Kubernetes `/healthz` probes, and Docker containerization.

### Project Scaffolding (create-shukoi)
- Updated CLI scaffolding templates to reference synchronized v1.0.3 package versions and canonical documentation URLs.

### Documentation Portal & Metadata
- Deployed enterprise VitePress documentation portal at `https://shukoilab.github.io/shukoi/` featuring live interactive OpenAPI 3.1.0 visualizer (Scalar) and updated canonical `homepage` across all package manifests.
