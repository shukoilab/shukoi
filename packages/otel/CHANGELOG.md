# @shukoi/otel

## 1.0.3

### Initial Release & Hardening

- Initial release of `@shukoi/otel`: Enterprise OpenTelemetry distributed tracing and Prometheus metrics plugin for Shukoi.
- **W3C TraceContext**: Parses and serializes standard `traceparent` headers across REST and MCP transports.
- **OTLP 1.34+ Compliance**: `OtlpHttpSpanExporter` now emits `service.name` and optional custom metadata inside `resource.attributes`.
- **Span Classification & Exception Logging**: Added `SpanKind` support and `span.recordException(error)` for standard OpenTelemetry exception events.
- **Prometheus Contiguity**: `serializeToPrometheusText` groups samples contiguously by metric family and safely escapes newlines in label values.
- **Span Lifecycle**: Automatic span instrumentation (`shukoi.action.${name}`) capturing action attributes, duration, error codes, and correlation IDs.
- **Dual Exporters**: Pure Web-standard OTLP/HTTP JSON exporter (`./edge`) and zero-dependency Prometheus text exposition exporter (`./prometheus`).
- **Resilience**: Bounded queue with $O(1)$ memory ceiling and drop-oldest backpressure eviction, preventing OOM.
- **In-Memory Testing Harness**: Provided `@shukoi/otel/testing` with `MockSpanExporter` and `MockMetricReader`.
