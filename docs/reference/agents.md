# Agent Skills & LLMs Integration

Shukoi is the first TypeScript micro-framework designed from day one to be operated seamlessly by both **human software engineers** and **autonomous AI coding agents** (Claude Desktop, Cursor, OpenCode, Antigravity IDE).

---

## The LLMs Content Protocol (`llms.txt` & `llms-full.txt`)

Shukoi publishes machine-readable documentation indices adhering to the `llms.txt` open standard:

- **[`/llms.txt`](https://github.com/shukoilab/shukoi/blob/main/llms.txt):** High-density summary index designed for LLM system prompts and fast context window ingestion.
- **[`/llms-full.txt`](https://github.com/shukoilab/shukoi/blob/main/llms-full.txt):** Complete technical reference containing all function signatures, schema validation rules, and error envelopes.

---

## The Agent Skills Suite (`skills/`)

Scaffolded Shukoi projects include pre-configured Agent Skills adhering to the [agentskills.io](https://agentskills.io) open standard:

### 1. `shukoi-create-action`
Guides AI agents in authoring protocol-agnostic business actions:
- Enforces `{ additionalProperties: false }` on all TypeBox schemas.
- Maps HTTP REST route variables and query parameters.
- Configures MCP tool hints, dynamic resource URI templates, and prompt workflows.

### 2. `shukoi-deploy-target`
Guides AI agents in configuring edge and cloud runtime adapters:
- Configures Cloudflare Workers with `waitUntil` and D1/KV mocks.
- Configures AWS Lambda with dynamic deadline subtraction.
- Configures Self-Host servers with Kubernetes `/healthz` probes and multi-stage Docker containerization.

### 3. `shukoi-quality-gates`
Enforces mandatory CI Quality Gates:
- `QG-01`: Tri-Transport Parity Test
- `QG-02`: Isolate JIT Fallback Test
- `QG-03`: MCP Per-Request Concurrency Race Test
- `QG-04`: Stream Ingress OOM Defense Test
- `QG-05`: STDIO stdout Sterility & Backpressure Drain Test
- `QG-06`: Zero Memory Leak Soak Test
- `QG-07`: Anti-Zombie Process Termination Test

### 4. `shukoi-distributed-resilience`
Guides AI agents in configuring production-grade distributed concurrency controls:
- Redis Idempotency Store with `wrapRedisClient` multi-driver normalization (`ioredis`, `node-redis`, `@upstash/redis`), atomic Lua scripts (`ACQUIRE_LUA`, `COMPLETE_LUA`, `RELEASE_LUA`), and `extendLock()` heartbeats.
- Distributed Rate Limiting via Sliding Window and Token Bucket algorithms (`TOKEN_BUCKET_LUA` in Redis Hash) with IETF Draft-08 headers.

### 5. `shukoi-otel-observability`
Guides AI agents in configuring distributed tracing and Prometheus metrics:
- OpenTelemetry W3C TraceContext distributed tracing with OTLP 1.34+ compliant `service.name` inside `resource.attributes` and `SpanKind` classification.
- Error recording via `span.recordException()`.
- Prometheus 0.0.4 contiguous text exposition registry (`/metrics`).

### 6. `shukoi-auth-rbac`
Guides AI agents in implementing zero-trust authentication and access control:
- Multi-strategy resolver combining cached JWKS rotation, $O(1)$ pre-hashed static API keys, HMAC session cookies, and RFC 7662 OIDC token introspection bounded by `BoundedLruCache(5000)`.
- Declarative action guards (`authRequired`, `roles`, `permissions`).

### 7. `shukoi-database-transactions`
Guides AI agents in relational database persistence and transaction orchestration:
- Modular adapters for Drizzle ORM, Kysely, Prisma Client, and Cloudflare D1.
- ANSI SQL `TransactionIsolationLevel` configuration.
- Native Cloudflare D1 `batch()` multi-statement atomicity.
- Transactional Outbox pattern with `shukoi_outbox_events` and dual-write consistency.

---

## Desktop AI Agent Setup

### Connecting Claude Desktop
Configure your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "my-service": {
      "command": "node",
      "args": ["dist/entries/mcp-stdio.js"]
    }
  }
}
```

### Connecting Cursor
In Cursor Settings $\rightarrow$ Features $\rightarrow$ MCP Servers $\rightarrow$ Add New MCP Server:
- **Name:** `shukoi-local`
- **Type:** `command`
- **Command:** `node dist/entries/mcp-stdio.js`
