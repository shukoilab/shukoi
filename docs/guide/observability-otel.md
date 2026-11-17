# Enterprise Observability & OpenTelemetry

> **Native W3C TraceContext distributed tracing and Prometheus metrics without heavy SDK overhead.**

Microservice and serverless architectures running on Kubernetes, Cloudflare Workers, and AWS Lambda require uniform correlation tracking, distributed span trees, and real-time operational metrics.

`@shukoi/otel` implements a pure Web-standard OpenTelemetry plugin for Shukoi that instruments declarative actions, captures W3C parent contexts, records latency quantiles, and flushes data via OTLP/HTTP or Prometheus text exposition.

---

## 1. Key Capabilities

| Capability | Module / Component | Invariant |
| :--- | :--- | :--- |
| **W3C Distributed Tracing** | `Tracer` / `Span` | Parses and serializes standard `traceparent` headers (`00-{trace_id}-{span_id}-{flags}`) across REST and MCP transports. |
| **Zero-Dependency Core** | `@shukoi/otel/edge` | Web-standard `fetch` OTLP/HTTP JSON exporter running with **0 `node:*` imports** in Cloudflare Workers and Edge runtimes. |
| **Prometheus Exposition** | `@shukoi/otel/prometheus` | Zero-dependency Prometheus text exposition format generator (`/metrics`) for Kubernetes scraping. |
| **O(1) Bounded Telemetry Buffer** | Circular Ring Buffer | Bounded queue ceiling (`maxQueueSize: 2048`) drops oldest spans under backpressure, completely eliminating Out-Of-Memory (OOM) risks. |
| **Automatic Context Binding** | `ActionExecutionContext` | Automatically exposes `ctx.traceId` and `ctx.spanId` for structured logging correlation. |

---

## 2. Attaching OpenTelemetry to Shukoi Actions

```typescript
import { createDefaultConfig } from '@shukoi/core';
import { createOpenTelemetryPlugin } from '@shukoi/otel';
import { orderAction } from './actions/order.js';

export const otelPlugin = createOpenTelemetryPlugin({
  serviceName: 'billing-service',
  serviceVersion: '1.0.3',
  maxQueueSize: 2048,
});

export const config = createDefaultConfig({
  plugins: [otelPlugin],
});
```

When an action executes, `@shukoi/otel` automatically creates an active span named `shukoi.action.<actionName>`:
- If caller provides `traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`, the span becomes a child of that trace.
- If no header is provided, a new random 32-hex trace ID is generated.
- Attributes recorded: `shukoi.action.name`, `shukoi.transport`, `shukoi.request_id`, `shukoi.idempotency_key`, `shukoi.user.id`.
- On success: sets status `OK` and records duration in milliseconds.
- On error: sets status `ERROR`, records `shukoi.error.code` and `shukoi.error.message`.

---

## 3. Scraping Prometheus Metrics in Self-Host

In Node.js or Bun environments (`@shukoi/selfhost`), expose the standard Prometheus `/metrics` endpoint:

```typescript
import { createRestRouter } from '@shukoi/api';
import { createSelfHostServer } from '@shukoi/selfhost';
import { PrometheusRegistry } from '@shukoi/otel/prometheus';
import { otelPlugin, config } from './config.js';
import { orderAction } from './actions/order.js';

const app = createRestRouter([orderAction], config);
const promRegistry = new PrometheusRegistry(otelPlugin.metrics);

// Mount Prometheus scraper route
app.get('/metrics', (c) => {
  return c.text(promRegistry.scrape(), 200, {
    'Content-Type': 'text/plain; version=0.0.4',
  });
});

export const server = createSelfHostServer(app, config);
```

Sample Prometheus exposition output:
```text
# HELP shukoi_action_calls_total Total count of Shukoi action invocations
# TYPE shukoi_action_calls_total counter
shukoi_action_calls_total{action="orderAction",status="success"} 142
# HELP shukoi_action_duration_ms Duration of Shukoi action executions in milliseconds
# TYPE shukoi_action_duration_ms histogram
shukoi_action_duration_ms_bucket{action="orderAction",le="10"} 89
shukoi_action_duration_ms_bucket{action="orderAction",le="50"} 138
shukoi_action_duration_ms_bucket{action="orderAction",le="+Inf"} 142
shukoi_action_duration_ms_sum{action="orderAction"} 2145
shukoi_action_duration_ms_count{action="orderAction"} 142
```

---

## 4. Edge Runtimes & Cloudflare Workers

In Cloudflare Workers, export spans to your OTel Collector, Datadog, or Honeycomb endpoint without blocking HTTP requests:

```typescript
import { createRestRouter } from '@shukoi/api';
import { toCloudflareWorker } from '@shukoi/cloudflare';
import { createDefaultConfig } from '@shukoi/core';
import { createOpenTelemetryPlugin, OtlpHttpSpanExporter } from '@shukoi/otel';
import { orderAction } from './actions/order.js';

const exporter = new OtlpHttpSpanExporter({
  endpoint: 'https://collector.example.com/v1/traces',
  serviceName: 'edge-service',
  resourceAttributes: {
    'deployment.environment': 'production',
  },
  timeoutMs: 5000,
});

export const otelPlugin = createOpenTelemetryPlugin({
  serviceName: 'edge-service',
  serviceVersion: '1.0.3',
  exporter,
});

export const config = createDefaultConfig({
  plugins: [otelPlugin],
});

export const app = createRestRouter([orderAction], config);

export default toCloudflareWorker(app);
```

---

## 5. Manual Spans, SpanKind & Exception Recording

You can create custom spans and log exceptions adhering to OpenTelemetry semantic conventions:

```typescript
const tracer = otelPlugin.tracer;

// Start a span with explicit SpanKind ('INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER')
const span = tracer.startSpan('externalPaymentCall', null, 'CLIENT');

try {
  await executePaymentGatewayCall();
  span.setStatus('OK');
} catch (err) {
  // Records exception.type, exception.message, and exception.stacktrace, setting status to ERROR
  span.recordException(err);
  throw err;
} finally {
  span.end();
}
```
