# @shukoi/otel

> **Enterprise OpenTelemetry Distributed Tracing & Prometheus Metrics Plugin for Shukoi**

[![npm version](https://img.shields.io/npm/v/@shukoi/otel.svg)](https://www.npmjs.com/package/@shukoi/otel)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`@shukoi/otel` provides plug-and-play observability and telemetry for Shukoi microservices across Node.js, Bun, Cloudflare Workers, and AWS Lambda without external heavy SDK bloat.

---

## Key Features & Invariants

- 🔭 **W3C TraceContext Compliant:** Parses and serializes standard `traceparent` headers across REST and MCP transports, linking incoming distributed traces to child execution spans.
- ⚡ **Pure Web-Standard Edge Exporter:** `OtlpHttpSpanExporter` (`./edge`) uses Web-standard `fetch` with zero `node:*` imports, operating natively in Cloudflare Workers V8 Isolates.
- 📦 **OTLP 1.34+ Specification Compliant:** Emits `service.name` and custom resource metadata under `resource.attributes`, ensuring out-of-the-box compatibility with Datadog, Jaeger, Grafana Tempo, and Honeycomb.
- 🏷️ **SpanKind & Semantic Exceptions:** Supports standard `SpanKind` ('INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER') and provides `span.recordException(err)` for semantic exception logging.
- 📊 **Prometheus Metrics Registry:** Contiguous text exposition format generator (`./prometheus`) adhering to Prometheus 0.0.4 for native Kubernetes scraping via `/metrics`.
- 🛡️ **Bounded Queue Ceiling:** Drop-oldest circular queue with backpressure protection (`maxQueueSize: 2048`, `batchSize: 512`) prevents Out-Of-Memory (OOM) failures under network partitions or collector outages.
- 🧪 **In-Memory Testing Harness:** Pre-configured `MockSpanExporter` and `MockMetricReader` in `@shukoi/otel/testing`.

---

## Installation

```bash
pnpm add @shukoi/otel @shukoi/core
```

---

## Usage

### 1. Attaching Telemetry to Shukoi Microservices

```typescript
import { createDefaultConfig } from '@shukoi/core';
import { createOpenTelemetryPlugin, OtlpHttpSpanExporter } from '@shukoi/otel';

// Configure OTLP HTTP span exporter
const exporter = new OtlpHttpSpanExporter({
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces',
  serviceName: 'order-service',
  resourceAttributes: {
    'deployment.environment': process.env.NODE_ENV ?? 'development',
  },
  timeoutMs: 5000,
});

// Instantiate Shukoi OpenTelemetry plugin
export const otelPlugin = createOpenTelemetryPlugin({
  serviceName: 'order-service',
  serviceVersion: '1.0.4',
  exporter,
  maxQueueSize: 2048,
  batchSize: 512,
});

// Register plugin via ShukoiConfig
export const config = createDefaultConfig({
  plugins: [otelPlugin],
});
```

### 2. Scraping Prometheus Metrics in REST Router

```typescript
import { createRestRouter } from '@shukoi/api';
import { PrometheusRegistry } from '@shukoi/otel';
import { otelPlugin, config } from './config.js';
import { orderAction } from './actions/order.js';

const app = createRestRouter([orderAction], config);

// Instantiate Prometheus registry bound to the plugin's metrics
const prometheus = new PrometheusRegistry(otelPlugin.metrics);

// Expose /metrics endpoint for Prometheus scrapers
app.get('/metrics', (c) => {
  return c.text(prometheus.scrape(), 200, {
    'Content-Type': 'text/plain; version=0.0.4',
  });
});
```

### 3. Manual Spans & Semantic Exception Recording

```typescript
const tracer = otelPlugin.tracer;

// Start active child span
const span = tracer.startSpan('processPayment', parentTraceContext, 'CLIENT');

try {
  await chargeCard();
  span.setStatus('OK');
} catch (err) {
  // Records standard OpenTelemetry exception attributes and sets status to ERROR
  span.recordException(err);
  throw err;
} finally {
  span.end();
}
```

---

## Configuration Reference

### `OpenTelemetryPluginConfig`

| Option           | Type           | Default      | Description                                                                  |
| :--------------- | :------------- | :----------- | :--------------------------------------------------------------------------- |
| `serviceName`    | `string`       | **Required** | Logical service name for distributed tracing and metrics.                    |
| `serviceVersion` | `string`       | `undefined`  | Optional semver service release version.                                     |
| `exporter`       | `SpanExporter` | `undefined`  | Span exporter instance (e.g., `OtlpHttpSpanExporter` or `MockSpanExporter`). |
| `maxQueueSize`   | `number`       | `2048`       | Maximum in-memory span queue length before drop-oldest eviction kicks in.    |
| `batchSize`      | `number`       | `512`        | Batch threshold triggering automatic exporter dispatch.                      |

### `OtlpHttpExporterOptions`

| Option               | Type                     | Default            | Description                                                         |
| :------------------- | :----------------------- | :----------------- | :------------------------------------------------------------------ |
| `endpoint`           | `string`                 | **Required**       | OTLP/HTTP collector traces endpoint URL.                            |
| `serviceName`        | `string`                 | `'shukoi-service'` | Service identifier emitted under `resource.attributes`.             |
| `resourceAttributes` | `Record<string, string>` | `undefined`        | Custom key-value pairs added to `resource.attributes`.              |
| `headers`            | `Record<string, string>` | `undefined`        | Optional authentication or tenant headers (e.g., `Authorization`).  |
| `timeoutMs`          | `number`                 | `5000` (5s)        | HTTP request timeout in milliseconds using `AbortSignal.timeout()`. |

---

## Testing Telemetry

Use `@shukoi/otel/testing` for zero-network assertions in unit tests:

```typescript
import { createOpenTelemetryPlugin } from '@shukoi/otel';
import { MockSpanExporter, MockMetricReader } from '@shukoi/otel/testing';

const mockExporter = new MockSpanExporter();
const otel = createOpenTelemetryPlugin({
  serviceName: 'test-service',
  exporter: mockExporter,
});

// Run actions...
const finishedSpans = mockExporter.getFinishedSpans();
expect(finishedSpans.length).toBeGreaterThan(0);
expect(finishedSpans[0].status.code).toBe('OK');
```
