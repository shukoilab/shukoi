# @shukoi/selfhost

## 1.0.3

### Patch Changes

- [`1650a07`](https://github.com/shukoilab/shukoi/commit/1650a07e090ccb22ad20d8079550a5fdd8952531) Thanks [@shukoilab](https://github.com/shukoilab)! - Release v1.0.3: Protocol Module A (API), Protocol Module B (MCP), and Runtime Adapters Overhaul:
  - **@shukoi/mcp**: Native support for MCP `resources/read` (static URIs & RFC 6570 templates), `prompts/get` with TypeBox argument introspection, multimodal `tools/call` blocks (Base64 images, raw strings), HTTP `DELETE` 204 session teardown, `Accept` negotiation, and sterile STDIO with sequential FIFO backpressure queue (`enqueueFrameWrite`).
  - **@shukoi/api**: OpenAPI 3.1.0 auto-extraction of query parameters for `GET`/`DELETE`, root `components.securitySchemes` (`bearerAuth` and `apiKeyAuth`), root `servers: [{ url: '/' }]`, universal RFC 9457 404 Problem Details (`app.notFound()`), safe leading-zero numeric strings, multi-value array query parameters, `customContentType` egress, and `Idempotent-Replayed: true` headers.
  - **@shukoi/core**: Added `InMemoryIdempotencyStore.get` inspection method for replay detection.
  - **@shukoi/cloudflare**: Added `getCloudflareContext`, `waitUntil` background execution, and in-memory D1/KV testing doubles.
  - **@shukoi/lambda**: Added `getLambdaContext`, dynamic deadline subtraction, API Gateway v1/v2 & ALB handling, cookies, and in-memory testing doubles.
  - **@shukoi/selfhost**: Added `getSelfHostContext`, stream-bounded body parsing ($O(1)$ heap OOM HTTP 413 defense), Kubernetes `/healthz` probes, and Docker containerization.
  - **create-shukoi**: Scaffolding templates and dependency synchronizer aligned with v1.0.3.
  - **Documentation & Metadata**: Deployed VitePress documentation portal at `https://shukoilab.github.io/shukoi/` featuring interactive OpenAPI 3.1.0 visualizer (Scalar) and updated canonical `homepage` across all manifests.
- Updated dependencies [[`1650a07`](https://github.com/shukoilab/shukoi/commit/1650a07e090ccb22ad20d8079550a5fdd8952531)]:
  - @shukoi/core@1.0.3

## 1.0.2

### Patch Changes

- [`f778ce3`](https://github.com/shukoilab/shukoi/commit/f778ce3268638f880b26032d32b6835b8b032128) Thanks [@shukoilab](https://github.com/shukoilab)! - Release v1.0.2:
  - **Licenses**: Distributed official MIT `LICENSE` files into all 7 packages and added `"license": "MIT"` along with `"LICENSE"` to package tarball manifests.
  - **NPM Discoverability & SEO**: Added rich package descriptions, repository directory pointers, bug trackers, and curated keywords (`shukoi`, `mcp`, `hono`, `typebox`, `micro-framework`, etc.) across all 7 packages.
  - **CI/CD Automation**: Enabled `SHUKOI_BOT_TOKEN` in release workflow to ensure automated release PRs execute without manual approval gates.
- Updated dependencies [[`f778ce3`](https://github.com/shukoilab/shukoi/commit/f778ce3268638f880b26032d32b6835b8b032128)]:
  - @shukoi/core@1.0.2

## 1.0.1

### Patch Changes

- [`b045fb8`](https://github.com/shukoilab/shukoi/commit/b045fb80177f52b0770ef1fcc17ff8a68029bc39) Thanks [@shukoilab](https://github.com/shukoilab)! - Release v1.0.1:
  - **create-shukoi**: Scaffolds target entrypoints (`src/entries/*.ts`) and `.gitignore` matching user selections.
  - **Documentation**: Exhaustive English package READMEs for all 7 packages and soft-sell problem-solution narrative for root landing page.
  - **CI/CD**: Upgraded GitHub Actions runners to Node 24 native actions eliminating deprecation warnings.
- Updated dependencies [[`b045fb8`](https://github.com/shukoilab/shukoi/commit/b045fb80177f52b0770ef1fcc17ff8a68029bc39)]:
  - @shukoi/core@1.0.1
