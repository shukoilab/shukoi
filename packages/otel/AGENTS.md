# @shukoi/otel Package Constitution

## Local Scope & Boundaries

`@shukoi/otel` implements OpenTelemetry distributed tracing, W3C TraceContext context propagation, and Prometheus metrics for Shukoi REST APIs and Model Context Protocol (MCP) agents.

### Invariants & Non-Negotiable Rules

1. **Pure Web-Standard Engine (Zero `node:*` Imports in `./edge`):**
   - The core telemetry plugin and `./edge` subpath MUST contain ZERO `node:*` imports or native C++ addons.
   - All network telemetry export operations must use Web-standard `fetch`.
2. **OTLP 1.34+ Specification Conformance:**
   - Payloads exported via `OtlpHttpSpanExporter` MUST include `service.name` inside `resource.attributes` to satisfy Jaeger, Datadog, and Grafana Tempo collectors.
   - Spans support standard `SpanKind` values (INTERNAL=1, SERVER=2, CLIENT=3, PRODUCER=4, CONSUMER=5) and semantic exception recording via `span.recordException()`.
3. **Zero Memory Leaks ($O(1)$ Buffer Ceiling):**
   - In-memory telemetry queues MUST use a bounded queue with a strict ceiling (`maxQueueSize: 2048`).
   - When downstream collectors are unavailable or backpressure occurs, the buffer drops the oldest spans to prevent Out-Of-Memory (OOM) crashes.
4. **W3C TraceContext Standard:**
   - Trace context propagation MUST adhere to the W3C TraceContext specification (`traceparent`).
   - If incoming requests contain malformed traceparents, a fresh valid root trace ID MUST be generated without throwing unhandled exceptions.
5. **Prometheus Contiguity & Escaping:**
   - Prometheus metrics output MUST group metric series contiguously by metric family before emitting `# HELP` and `# TYPE` headers.
   - Label values must safely escape backslashes, quotes, and newlines (`\n`).
6. **Universal 7-Tag Docstrings:**
   - Every interface, class, method, function, and exported constant must include all 7 native docstring tags (`@purpose`, `@rationale`, `@preconditions`, `@param`, `@returns`, `@throws`, `@invariants`).
