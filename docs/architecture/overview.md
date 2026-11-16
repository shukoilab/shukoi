# System Architecture

This document specifies the technical design, non-negotiable architectural laws, and runtime mechanics of the Shukoi framework.

---

## 1. High-Level System Topology

Shukoi acts as an abstraction bridge between declarative business actions and the heterogeneous runtime and protocol environments of modern distributed computing:

```text
                     ┌────────────────────────────────────────┐
                     │         Shukoi Action Engine           │
                     │    (defineAction + Strict TypeBox)     │
                     └───────────────────┬────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
    ┌─────────────────────────┐                     ┌─────────────────────────┐
    │   Protocol Module A     │                     │   Protocol Module B     │
    │     (@shukoi/api)       │                     │     (@shukoi/mcp)       │
    │  • Hono REST Router     │                     │  • Scoped MCP Servers   │
    │  • OpenAPI 3.1.0        │                     │  • Streamable HTTP      │
    │  • RFC 9457 Errors      │                     │  • Sterile STDIO        │
    │  • Stream OOM Defense   │                     │  • Tools/Resources/Prompts
    └────────────┬────────────┘                     └────────────┬────────────┘
                 │                                               │
                 └───────────────────────┬───────────────────────┘
                                         ▼
                     ┌────────────────────────────────────────┐
                     │          3 Runtime Adapters            │
                     ├───────────────────┬────────────────────┤
                     │ Cloudflare        │ Edge V8 Isolates   │
                     │ AWS Lambda        │ Serverless Deadlines│
                     │ Self-Host         │ Node/Bun + Draining│
                     └───────────────────┴────────────────────┘
```

---

## 2. The Twelve Architectural Laws

1. **Zero-Guesswork Contracts:** All action inputs, outputs, errors, and configurations are defined using `@sinclair/typebox` schemas. Input is validated at ingress; output is cleaned and validated at egress.
2. **Zero-Hardcoding:** Hardcoding timeouts, limits, URLs, or secrets is strictly forbidden. All parameters are injected via `ShukoiConfig`.
3. **Zero Memory Leaks:** Unbounded global maps/sets are forbidden. Stores use bounded LRU and TTL eviction. Timers must use `.unref()` or be cleared in `finally`.
4. **Zero Race Conditions:** Action contexts are deeply frozen (`Object.freeze`). JWKS key discovery uses a Single-Flight Mutex (`inFlightPromise`). Concurrent mutations serialize via atomic Idempotency Locks.
5. **Zero Zombie Processes:** STDIO mode monitors `stdin` (`end`/`close`), `stdout` (`EPIPE`), and parent PID. Self-host servers execute a Graceful Drain State Machine.
6. **Strict `stdout` Sterility:** File Descriptor 1 (`process.stdout`) in STDIO mode is exclusively reserved for newline-delimited JSON-RPC 2.0 frames with `drain` backpressure handling. Application logs route to `process.stderr`.
7. **Pure Web-Standard Core:** `@shukoi/core`, `@shukoi/api`, `@shukoi/mcp/http`, and `@shukoi/cloudflare` contain 0 `node:*` imports.
8. **Isolate-Safe Adaptive Validation:** Validator probes `new Function` capability (`SUPPORTS_JIT`), using JIT `TypeCompiler` in Node/Bun and falling back to AST `Value.Check` in Cloudflare Workers.
9. **Stream-Level Defense-in-Depth:** Bodies read via bounded stream byte-counter aborting immediately at `maxBodyBytes` with HTTP 413. Inputs enforce `additionalProperties: false`, prototype stripping, and depth limits.
10. **Output Data Sanitization:** Handler returns pass through `Value.Clean(outputSchema, result)` before validation, stripping unexposed ORM fields.
11. **Protocol-Agnostic Business Logic:** Handlers interact only with typed input and `ActionExecutionContext`. Never touch raw HTTP Request/Response or JSON-RPC envelopes inside action logic.
12. **Composite Cancellation & Deadline Propagation:** Every action receives a unified `AbortSignal` combining caller disconnect, timeout, and container deadline.

---

For deeper exploration of these design decisions, read the [Architecture Decision Records (ADRs)](/architecture/adrs).
