---
name: shukoi-quality-gates
description: Implements and verifies the mandatory Seven CI Quality Gates (QG-01 through QG-07) in a Shukoi monorepo or application. Use whenever writing integration tests, verifying multi-transport parity, testing OOM defense, or profiling memory leak resilience.
compatibility: TypeScript 5.5+, Vitest 3.x, @shukoi/core
---

# Verifying Shukoi CI Quality Gates (QG-01 to QG-07)

## Overview
Every Shukoi microservice and monorepo component must pass all seven automated quality gates in CI before merging:

- **QG-01 (Tri-Transport Parity):** Verify that executing an action directly (`executeAction`), via REST (`app.request()`), and via MCP (`scopedServer.handleJsonRpc()`) produces 100% identical stripped outputs and error responses.
- **QG-02 (Isolate Fallback Equivalence):** Verify that JIT mode (`TypeCompiler`) and AST fallback mode (`Value.Check`) evaluate complex schemas identically.
- **QG-03 (Concurrent Stateless MCP Race):** Fire 200 concurrent HTTP requests with distinct tokens and simulated latencies. Verify zero token bleed or transport overwrite errors.
- **QG-04 (Chunked Stream OOM Defense):** Stream an infinite body without Content-Length. Verify reader aborts immediately at `maxBodyBytes` with HTTP 413.
- **QG-05 (STDIO stdout Sterility & Drain):** Run child process emitting noisy logs and 512KB payload. Verify stdout contains 100% valid JSON-RPC and logs route to stderr.
- **QG-06 (Zero Memory Leak Soak):** Run 10,000 executions with 2,000 mid-flight cancellations. Verify heap drift is bounded and inFlight stores clear.
- **QG-07 (Anti-Zombie Process Kill):** Spawn STDIO process and destroy stdin. Verify process exits code 0 within 200 ms.

For detailed test patterns and assertion recipes, read [references/quality-gates.md](references/quality-gates.md).
