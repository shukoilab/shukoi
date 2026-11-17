# @shukoi/otel

## 1.0.3

### Initial Release

- Initial release of `@shukoi/otel`: Enterprise OpenTelemetry distributed tracing and Prometheus metrics plugin for Shukoi.
- **W3C TraceContext**: Parses and serializes standard `traceparent` and `tracestate` headers across REST and MCP transports.
- **Span Lifecycle**: Automatic span instrumentation (`shukoi.action.execute`) capturing action attributes, duration, error codes, and correlation IDs.
- **Dual Exporters**: Pure Web-standard OTLP/HTTP JSON exporter (`./edge`) and zero-dependency Prometheus text exposition exporter (`./prometheus`).
- **Resilience**: Bounded circular ring buffer with $O(1)$ memory ceiling and drop-oldest backpressure eviction, preventing OOM.
- **In-Memory Testing Harness**: Provided `@shukoi/otel/testing` with `MockSpanExporter` and `MockMetricReader`.
