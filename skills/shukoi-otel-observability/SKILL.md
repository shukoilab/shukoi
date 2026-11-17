---
name: shukoi-otel-observability
description: Guides implementing OpenTelemetry distributed tracing, W3C TraceContext correlation, and Prometheus metrics using @shukoi/otel in Shukoi applications. Use whenever actions need tracing or microservices expose /metrics endpoints.
compatibility: TypeScript 5.5+, @shukoi/core, @shukoi/otel
---

# Implementing OpenTelemetry & Metrics in Shukoi

## Core Invariants for AI Coding Agents

1. **W3C TraceContext Compliance:** Always propagate `traceparent` and `tracestate` headers across RPC and HTTP boundaries. Never invent custom trace headers when W3C standards apply.
2. **Zero Memory Leaks ($O(1)$ Buffer Ceiling):** The in-memory telemetry queue enforces a hard ceiling (`maxQueueSize: 2048`) with drop-oldest eviction. Telemetry export must never cause process Out-Of-Memory (OOM) failures.
3. **Pure Web-Standard Edge Compatibility:** In Cloudflare Workers and Edge runtimes, use `@shukoi/otel/edge` with `OtlpHttpSpanExporter`. Never import `node:*` modules.
4. **Non-Blocking Telemetry:** Plugin hooks (`onActionStart`, `onActionSuccess`, `onActionError`, `onActionTeardown`) must handle exceptions internally without crashing host business actions.

---

## 1. Configuring OpenTelemetry Tracing

```typescript
import { createDefaultConfig } from '@shukoi/core';
import { createOpenTelemetryPlugin, OtlpHttpSpanExporter } from '@shukoi/otel';
import { orderAction } from './actions/order.js';

const otelPlugin = createOpenTelemetryPlugin({
  serviceName: 'order-service',
  serviceVersion: '1.0.3',
  exporter: new OtlpHttpSpanExporter({
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces',
  }),
});

export const config = createDefaultConfig({
  plugins: [otelPlugin],
});
```

---

## 2. Scraping Prometheus Metrics in Self-Host

```typescript
import { createRestRouter } from '@shukoi/api';
import { createSelfHostServer } from '@shukoi/selfhost';
import { PrometheusRegistry } from '@shukoi/otel/prometheus';
import { config, otelPlugin } from './config.js';
import { orderAction } from './actions/order.js';

const app = createRestRouter([orderAction], config);
const promRegistry = new PrometheusRegistry(otelPlugin.metrics);

app.get('/metrics', (c) => {
  return c.text(promRegistry.scrape(), 200, {
    'Content-Type': 'text/plain; version=0.0.4',
  });
});

export const server = createSelfHostServer(app, config);
```
