# SHUKOI MONOREPO CONSTITUTION (`AGENTS.md`)

This document is the authoritative repository constitution for all autonomous AI coding agents (Antigravity IDE, Claude Code, Cursor, Codex, Zed) operating inside the Shukoi monorepo (`@shukoi/*`).

---

## 1. Monorepo Topology & Package Scopes

```text
shukoi/
├── packages/
│   ├── core/          # @shukoi/core (Universal Action Engine, Adaptive Validator, Auth, Logger, Testing)
│   ├── api/           # @shukoi/api (Hono REST Router, OpenAPI 3.1.0 Generator, RFC 9457 Problem Details)
│   ├── mcp/           # @shukoi/mcp (Subpaths: ./http and ./stdio)
│   ├── cloudflare/    # @shukoi/cloudflare (Cloudflare Workers V8 Isolate Adapter + waitUntil)
│   ├── lambda/        # @shukoi/lambda (AWS Lambda Adapter + Dynamic Deadline Subtraction)
│   ├── selfhost/      # @shukoi/selfhost (Bun/Node Server + Graceful Shutdown State Machine + Probes)
│   └── create-shukoi/ # create-shukoi (Interactive Clack & CI Scaffolder CLI)
├── docs/              # System Architecture & Architecture Decision Records (ADRs)
├── skills/            # Agent Skills Suite (agentskills.io Open Standard)
└── test/              # Monorepo CI Quality Gates (QG-01 to QG-07)
```

---

## 2. Standard Toolchain & Verification Commands

All agents must verify code changes using these exact commands before declaring a task complete:

- **Static Analysis & Linting:** `pnpm run lint` (`biome check .`)
- **Automatic Formatting:** `pnpm run format` (`biome format --write .`)
- **Strict Typecheck:** `pnpm run typecheck` (`tsc -b`)
- **Full Test Suite:** `pnpm test`
- **CI Quality Gates (QG-01 to QG-07):** `pnpm run test:qg`
- **Monorepo Build:** `pnpm -r run build`

---

## 3. The Twelve Non-Negotiable Architectural Laws

1. **Zero-Guesswork Contracts:** All action inputs, outputs, errors, and configurations are defined using `@sinclair/typebox` schemas. Input is validated at ingress; output is cleaned and validated at egress.
2. **Zero-Hardcoding:** Hardcoding timeouts, limits, URLs, or secrets is strictly forbidden. All parameters are injected via `ShukoiConfig`.
3. **Zero Memory Leaks:** Unbounded global maps/sets are forbidden. Stores use bounded LRU and TTL eviction. Timers must use `.unref()` or be cleared in `finally`.
4. **Zero Race Conditions:** Action contexts are deeply frozen (`Object.freeze`). JWKS key discovery uses a Single-Flight Mutex (`inFlightPromise`). Concurrent mutations serialize via atomic Idempotency Locks.
5. **Zero Zombie Processes:** STDIO mode monitors `stdin` (`end`/`close`), `stdout` (`EPIPE`), and parent PID. Self-host servers execute a Graceful Drain State Machine.
6. **Strict `stdout` Sterility:** File Descriptor 1 (`process.stdout`) in STDIO mode is exclusively reserved for newline-delimited JSON-RPC 2.0 frames with `drain` backpressure handling. Application logs route to `process.stderr`.
7. **Pure Web-Standard Core:** `@shukoi/core`, `@shukoi/api`, `@shukoi/mcp/http`, and `@shukoi/cloudflare` contain 0 `node:*` imports.
8. **Isolate-Safe Adaptive Validation:** Validator probes `new Function` capability (`SUPPORTS_JIT`), using JIT `TypeCompiler` in Node/Bun and falling back to AST `Value.Check` in Cloudflare Workers.
9. **Stream-Level Defense-in-Depth:** Bodies read via bounded stream byte-counter aborting immediately at `maxBodyBytes` with HTTP 413. Inputs enforce `additionalProperties: false`, prototype stripping, and depth limits.
10. **Output Data Sanitization:** Handler returns pass through `Value.Clean(outputSchema, result)` before validation, stripping unexposed ORM fields (e.g. password hashes).
11. **Protocol-Agnostic Business Logic:** Handlers interact only with typed input and `ActionExecutionContext`. Never touch raw HTTP Request/Response or JSON-RPC envelopes inside action logic.
12. **Composite Cancellation & Deadline Propagation:** Every action receives a unified `AbortSignal` (`AbortSignal.any`) combining caller disconnect, timeout, and container deadline.

---

## 4. Universal 7-Tag Docstring Standard

Every created or modified interface, class, method, function, and exported constant must include all 7 native docstring tags:
- `@purpose`: System-level objective and responsibility.
- `@rationale`: Architectural trade-offs justifying the design.
- `@preconditions`: Required state invariants, dependencies, and input constraints.
- `@param`: Domain types, valid ranges, and boundary limits per argument.
- `@returns`: Return semantics, state mutations, and output invariants.
- `@throws`: Typed exceptions/errors and exact trigger conditions.
- `@invariants`: Big-O time/space complexity, thread safety, and memory ownership.

---

## 5. Do Not Touch / Intentional Patterns (Read ADRs Before Editing)

Before attempting to "simplify" or refactor code in these areas, read the corresponding Architecture Decision Record:
- **Do not refactor `createScopedMcpServer` into a singleton** $\rightarrow$ Read [docs/adr/002-per-request-mcp-server.md](docs/adr/002-per-request-mcp-server.md).
- **Do not remove `SUPPORTS_JIT` probe in `validator.ts`** $\rightarrow$ Read [docs/adr/001-adaptive-typebox-jit.md](docs/adr/001-adaptive-typebox-jit.md).
- **Do not remove `SingleFlightJwksClient` in-flight promise map** $\rightarrow$ Read [docs/adr/003-single-flight-jwks-discovery.md](docs/adr/003-single-flight-jwks-discovery.md).
- **Do not replace stream chunk counter with Content-Length check** $\rightarrow$ Read [docs/adr/004-stream-bounded-body-parsing.md](docs/adr/004-stream-bounded-body-parsing.md).
- **Do not use `console.log` in framework sources** $\rightarrow$ Read [docs/adr/005-sterile-stdout-and-anti-zombie.md](docs/adr/005-sterile-stdout-and-anti-zombie.md).
