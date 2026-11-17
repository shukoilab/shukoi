# @shukoi/otel Package Constitution

## Local Scope & Boundaries

`@shukoi/otel` implements OpenTelemetry distributed tracing, W3C TraceContext context propagation, and Prometheus metrics for Shukoi REST APIs and Model Context Protocol (MCP) agents.

### Invariants & Non-Negotiable Rules

1. **Pure Web-Standard Engine (Zero `node:*` Imports in `./edge`):**
   - The core telemetry plugin and `./edge` subpath MUST contain ZERO `node:*` imports or native C++ addons.
   - All network telemetry export operations must use Web-standard `fetch`.
2. **Zero Memory Leaks ($O(1)$ Buffer Ceiling):**
   - In-memory telemetry queues MUST use a bounded circular ring buffer with a strict ceiling (`maxQueueSize: 2048`).
   - When downstream collectors are unavailable or backpressure occurs, the buffer MUST drop the oldest spans (_drop oldest_) to guarantee $O(1)$ space and prevent Out-Of-Memory (OOM) crashes.
3. **W3C TraceContext Standard:**
   - Trace context propagation MUST adhere to the W3C TraceContext specification (`traceparent` and `tracestate`).
   - If incoming requests contain malformed traceparents, a fresh valid root trace ID MUST be generated without throwing unhandled exceptions.
4. **Universal 7-Tag Docstrings:**
   - Every interface, class, method, function, and exported constant must include all 7 native docstring tags (`@purpose`, `@rationale`, `@preconditions`, `@param`, `@returns`, `@throws`, `@invariants`).
