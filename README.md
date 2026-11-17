# SHUKOI (`@shukoi/*`)

> **Write once. Expose everywhere.**  
> A contract-first TypeScript micro-framework. Author business logic once in a single declarative action—automatically expose production-ready **REST APIs (OpenAPI 3.1)**, **MCP Streamable HTTP servers**, and **MCP STDIO tools** across **Cloudflare Workers**, **AWS Lambda**, and **Bun/Node.js**.

[![CI Quality Gates](https://github.com/shukoilab/shukoi/actions/workflows/ci.yml/badge.svg)](https://github.com/shukoilab/shukoi/actions/workflows/ci.yml)
[![Documentation](https://img.shields.io/badge/Docs-GitHub_Pages-blue.svg)](https://shukoilab.github.io/shukoi/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript: 5.7+](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)
[![Linter: Biome](https://img.shields.io/badge/Linter-Biome-60a5fa.svg)](https://biomejs.dev/)
[![Pure Web Standard](https://img.shields.io/badge/Runtime-Pure_Web_Standard-success.svg)](https://github.com/shukoilab/shukoi)

---

## The Problem: Backend Architecture in the Age of AI is Broken

Software engineering teams no longer build "just a REST API." In the era of autonomous AI agents, your backend services must simultaneously power:

1. **Web & Mobile Applications** via traditional REST endpoints and OpenAPI 3.1 specifications.
2. **AI Coding Agents** (Claude Desktop, Cursor, OpenCode, Antigravity) via the Model Context Protocol (MCP).
3. **Local Developer Workflows & CLI Agents** over standard input/output (STDIO) streams.

### The Fragmented Reality Today
To support all three interfaces, teams are forced to **write the same business logic three times**:
- Once inside an Express, Fastify, or Hono router for REST consumers.
- Once inside `@modelcontextprotocol/sdk` for LLM tool calling.
- Once inside standalone scripts for local CLI automation.

Then the runtime friction begins:
- **Schema Drift:** When a database schema changes, updating validation rules across three protocol stacks is error-prone.
- **Isolate Incompatibility:** Code authored for Node.js crashes inside Cloudflare Workers due to `node:*` imports or `EvalError` in V8 isolates.
- **Protocol Corruption:** A stray `console.log()` pollutes File Descriptor 1 (`stdout`), breaking JSON-RPC framing and crashing the user's IDE.
- **Orphan Zombie Processes:** An IDE disconnect leaves background worker processes dangling indefinitely, consuming server memory.

---

## The Solution: The Write-Once Contract-First Paradigm

Shukoi terminates this fragmentation. You define your business logic, validation schemas, security policies, and cancellation boundaries **once in a single declarative action (`defineAction`)**. 

Shukoi automatically compiles and mounts your action across three production outputs and three cloud runtimes without code duplication:

```text
               1 Core Engine (@shukoi/core: defineAction)
                                  │
         ┌────────────────────────┼────────────────────────┐
         ▼                        ▼                        ▼
   Protocol Module A        Protocol Module B       Distributed Resilience
     (@shukoi/api)            (@shukoi/mcp)          (@shukoi/store-redis &
         │                        │                  @shukoi/ratelimit)
   ┌─────┴─────┐            ┌─────┴─────┐                  │
   ▼           ▼            ▼           ▼                  ▼
1. REST API  2. OpenAPI   3. MCP HTTP 4. MCP STDIO    Atomic Idempotency &
   │           │            │           │             Sliding Window Rate Limit
   └───────────┼────────────┴───────────┼──────────────────┘
               ▼                        ▼
     3 Deployment Runtime Targets
       • Cloudflare Workers (@shukoi/cloudflare: V8 Isolates, waitUntil, D1/KV mocks)
       • AWS Lambda (@shukoi/lambda: Node.js 22+ ESM, dynamic deadline, cookies, mocks)
       • Self-Host (@shukoi/selfhost: Bun 1.2+ / Node 22+ / Docker, OOM 413, probes)
```

---

## The 1-File Action Pattern

Here is what building a production-ready feature looks like in Shukoi—schema validation, REST routing, OpenAPI metadata, MCP tool declaration, idempotency, and cancellation in **under 60 lines**:

```typescript
import { Type } from '@sinclair/typebox';
import { defineAction, DomainError } from '@shukoi/core';

export const processPaymentAction = defineAction({
  name: 'processPayment',
  summary: 'Authorizes and captures customer payment',
  description: 'Validates payment boundaries, enforces atomic idempotency, and charges payment provider',
  authRequired: true,
  requiredScopes: ['payments:write'],
  timeoutMs: 15000,
  http: {
    method: 'POST',
    path: '/payments',
    successStatus: 201,
    requireIdempotencyKey: true, // Auto-enforces exactly-once execution on retries
  },
  mcp: {
    enabled: true,
    entityType: 'tool',
    annotations: {
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  input: Type.Object(
    {
      orderId: Type.String({ minLength: 1, description: 'Unique order identifier' }),
      amount: Type.Number({ minimum: 0.01, description: 'Charge amount in USD' }),
      currency: Type.Literal('USD'),
    },
    { additionalProperties: false },
  ),
  output: Type.Object(
    {
      success: Type.Boolean(),
      transactionId: Type.String(),
      chargedAmount: Type.Number(),
    },
    { additionalProperties: false },
  ),
  async handler(input, ctx) {
    ctx.logger.info('Processing payment', { orderId: input.orderId });

    // Composite signal automatically handles client disconnect, timeout, and container deadline
    if (ctx.signal.aborted) {
      throw new DomainError('GATEWAY_TIMEOUT', 'Payment execution cancelled', 504);
    }

    // Register deterministic cleanup hooks (executed LIFO in finally)
    ctx.onFinally(async () => {
      ctx.logger.debug('Releasing payment lock', { orderId: input.orderId });
    });

    const result = await ctx.services.paymentGateway.charge(input);

    return {
      success: true,
      transactionId: result.id,
      chargedAmount: input.amount,
      // Internal ORM columns like internal_audit_secret are automatically stripped via Value.Clean
    };
  },
});
```

---

## Engineered for Real-World Production

Shukoi was architected from day one to enforce **Twelve Non-Negotiable Invariants**:

- ⚡ **Isolate-Safe Adaptive JIT:** Capability probe detects runtime environment at boot—executes TypeBox JIT (`TypeCompiler`) on Node.js/Bun for sub-millisecond validation, and seamlessly falls back to AST evaluation (`Value.Check`) on Cloudflare Workers where `new Function()` throws `EvalError`.
- 🛡️ **AppSec & Defense-in-Depth:**
  - **Constant-Time Crypto:** Token and API key comparisons use Web Crypto SHA-256 bitwise XOR loops (`safeCompareSecrets`), eliminating timing side-channels.
  - **DNS-Rebinding Defense:** Built-in Host and Origin pinning protects local MCP HTTP servers against cross-origin browser rebinding attacks.
  - **Chunked Stream OOM Defense:** `readBoundedJsonStream` counts incoming stream bytes and aborts immediately at `maxBodyBytes` with HTTP 413, defeating unauthenticated chunked DoS attacks.
  - **Prototype Pollution Defense:** Incoming payloads recursively traverse through `Object.create(null)` to strip `__proto__`, `constructor`, and `prototype` keys.
- 🤖 **100% Sterile stdout & Anti-Zombie Watchdog:**
  - In STDIO mode, all `console.*` methods are hijacked and routed to `process.stderr`. File Descriptor 1 (`stdout`) is reserved strictly for clean newline-delimited JSON-RPC 2.0 frames with kernel backpressure drain handling.
  - The stdin watchdog monitors parent IDE pipe liveness, terminating child processes cleanly (`exit(0)`) within 200 ms if the host editor crashes.
- 🛑 **Production Process Lifecycle:**
  - **Self-Host:** Built-in Kubernetes probes (`/healthz/live` & `/healthz/ready`). On `SIGTERM`/`SIGINT`, readiness flips to 503, socket listeners stop accepting new ingress, active requests drain up to the grace period, and database connections close cleanly.
  - **AWS Lambda:** Dynamically computes `effectiveTimeoutMs = min(actionTimeout, remainingTime - lambdaDeadlineBufferMs)`. Aborts with 504 before AWS freezes the container, ensuring database transactions roll back cleanly.
- 🔒 **Distributed Atomic Idempotency (`@shukoi/store-redis`):** Eliminates TOCTOU race conditions across multi-instance clusters via atomic Redis Lua scripts (`ACQUIRE_LUA`, `COMPLETE_LUA`, `RELEASE_LUA`). Ships dual runtimes: native TCP socket pool (`./node`) for Node/Bun and pure Web-fetch `UpstashRedisClient` (`./edge`) with zero `node:*` imports for Cloudflare Workers.
- 🚦 **Universal Rate Limiting & DoS Defense (`@shukoi/ratelimit`):** Dual-algorithm engine featuring Sliding Window Counter (smooth, boundary burst-free) and Token Bucket (burst-tolerant for LLM token quotas). Emits standard IETF draft headers (`RateLimit-*`, `Retry-After`), integrates with RFC 9457 (429 Problem Details), and strictly caps in-memory fallback memory to $O(1)$ space via `BoundedLruCache(10000)`.

---

## Scaffolding a New Service in 60 Seconds

The `create-shukoi` CLI bootstraps a complete, production-ready microservice with **strict dependency pruning** (only installs packages for the products and targets you select):

### Interactive Terminal Mode
```bash
npm create shukoi@latest my-service
# or
pnpm create shukoi@latest my-service
# or
bun create shukoi@latest my-service
```

### Non-Interactive CI / Automation Mode
```bash
npm create shukoi@latest my-service -- \
  --products api,mcp-http \
  --targets cloudflare,selfhost \
  --idempotency redis \
  --ratelimit redis \
  --pm pnpm
```

Every scaffolded project includes:
- Strongly-typed, fail-fast configuration (`src/config.ts`)
- Production-ready sample action (`src/actions/health.ts`)
- Target entrypoints (`src/entries/`)
- Pre-configured Vitest test suite (`test/health.test.ts`)
- Biome static analysis rules (`biome.json`)
- AI agent guidance constitution (`AGENTS.md`, `CLAUDE.md`, and `skills/`)

---

## Scoped NPM Package Matrix

| Package Name | Purpose | Node.js Built-ins | Target Runtime |
| :--- | :--- | :--- | :--- |
| **`@shukoi/core`** | Action Engine, Adaptive Validator, Auth, Sterile Logger, Testing Harness | **Forbidden** (Pure Web Standard) | All Runtimes |
| **`@shukoi/api`** | Hono REST Router, Stream-Bounded Reader, OpenAPI 3.1.0 Generator (query params, securitySchemes), RFC 9457 Problem Details | **Forbidden** (Pure Web Standard) | All Runtimes |
| **`@shukoi/mcp`** | Streamable HTTP (`./http`: DELETE 204, DNS-rebinding) & Sterile STDIO (`./stdio`: FIFO queue, backpressure) MCP (Tools, Resources, Prompts) | Only in `./stdio` | Edge & Node/Bun |
| **`@shukoi/cloudflare`**| Cloudflare Workers V8 Isolate Adapter (`getCloudflareContext`, `waitUntil`, `./testing` mocks) | **Forbidden** (Pure Web Standard) | Cloudflare Workers |
| **`@shukoi/lambda`** | AWS Lambda Adapter with dynamic deadline subtraction (`getLambdaContext`, cookies, `./testing` mocks) | Permitted | AWS Lambda |
| **`@shukoi/selfhost`** | Bun/Node Server with Graceful Drain, OOM 413 defense (`getSelfHostContext`, probes, `./testing` mocks) | Permitted | Bun 1.2+ / Node 22+ |
| **`@shukoi/store-redis`** | Distributed Redis Idempotency Store with atomic Lua scripts, dual runtime (`./node` and `./edge`), and in-memory mocks (`./testing`) | Allowed only in `./node` (Edge is pure Web fetch) | Node/Bun & Cloudflare Workers |
| **`@shukoi/ratelimit`** | Universal Distributed Rate Limiter (Sliding Window & Token Bucket) with bounded LRU memory protection, IETF headers, and in-memory mocks (`./testing`) | **Forbidden** (Pure Web Standard) | All Runtimes |
| **`create-shukoi`** | Interactive Clack & CI automation project scaffolder CLI | Permitted | Node 22+ / Bun |

---

## First-Class AI Agent Context

Shukoi was engineered to be consumed by autonomous AI coding assistants without context drift:

- **Repository Constitution ([AGENTS.md](AGENTS.md)):** Strict architectural rules, package topologies, and testing commandments.
- **Claude Code Pointer ([CLAUDE.md](CLAUDE.md)):** Single-line reference ensuring unified instructions across tools.
- **Architecture Specification ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)):** Deep execution pipeline, concurrency, and error mapping topology.
- **Architecture Decision Records ([docs/adr/](docs/adr/)):** Protects intentional edge-case defenses against AI refactoring regressions.
- **Open Standard Agent Skills ([skills/](skills/)):** Follows the [agentskills.io](https://agentskills.io) specification for progressive disclosure.
- **Compact LLM Context ([llms.txt](llms.txt) & [llms-full.txt](llms-full.txt)):** Structured text index for instant context window ingestion.

---

## Verification & Quality Gates

Every component in `@shukoi/*` and every service created by `create-shukoi` must pass all seven automated quality gates:

```bash
pnpm run lint        # Sub-100ms static analysis via Biome
pnpm run typecheck   # Strict TypeScript compilation (tsc -b)
pnpm test            # All unit and integration test suites
pnpm run test:qg     # Mandatory Seven CI Quality Gates (QG-01 to QG-07)
pnpm -r run build    # Monorepo build
```

| Gate ID | Verification Name | Pass Criteria |
| :--- | :--- | :--- |
| **QG-01** | **Tri-Transport Parity** | `executeAction()`, REST, and MCP produce 100% identical outputs and error codes. |
| **QG-02** | **Isolate Fallback Equivalence** | JIT mode (`TypeCompiler`) and AST mode (`Value.Check`) yield identical checks. |
| **QG-03** | **Concurrent Stateless MCP Race** | 200 parallel HTTP requests execute without context leakage or transport collisions. |
| **QG-04** | **Chunked Stream OOM Defense** | Streams without `Content-Length` abort at `maxBodyBytes` with HTTP 413. |
| **QG-05** | **STDIO stdout Sterility & Drain** | Outbound 512 KB payload streams cleanly on stdout; all logs route to stderr. |
| **QG-06** | **Zero Memory Leak Soak** | 10,000 executions with 2,000 cancellations; heap drift remains strictly bounded. |
| **QG-07** | **Anti-Zombie Process Kill** | Destroying stdin terminates child STDIO processes with exit code 0 within 200 ms. |

---

## Contributing & Development

Contributions are welcome! Please ensure all pull requests pass `pnpm run lint`, `pnpm run typecheck`, and `pnpm run test:qg` before opening a PR.

```bash
git clone git@github.com:shukoilab/shukoi.git
cd shukoi
pnpm install
pnpm -r run build
pnpm test
```

---

## License

MIT © [Shukoi Contributors](https://github.com/shukoilab/shukoi)
