# @shukoi/otel

> **Enterprise OpenTelemetry Distributed Tracing & Prometheus Metrics Plugin for Shukoi.**

`@shukoi/otel` provides plug-and-play observability and telemetry for Shukoi applications across Node.js, Bun, Cloudflare Workers, and AWS Lambda without external heavy SDK bloat.

---

## Features

- 🔭 **W3C TraceContext Compliant:** Parses and propagates standard `traceparent` and `tracestate` headers across REST and MCP transports.
- ⚡ **Zero-Dependency Pure Web-Standard Core:** Pure Web-standard OTLP/HTTP JSON exporter (`./edge`) runs in Cloudflare Workers V8 Isolates with zero `node:*` imports.
- 📊 **Prometheus Metrics:** Integrated text exposition format exporter (`./prometheus`) for native Kubernetes scraping via `/metrics`.
- 🛡️ **O(1) Bounded Telemetry Buffer:** Drop-oldest circular ring buffer prevents Out-Of-Memory (OOM) failures under network partitions or collector outages.
- 🔗 **Correlation ID Propagation:** Automatically links `traceId` and `spanId` to the Shukoi structured logger and action execution context.
- 🧪 **In-Memory Testing Double:** Pre-configured `MockSpanExporter` and `MockMetricReader` in `@shukoi/otel/testing`.

---

## Installation

```bash
pnpm add @shukoi/otel @shukoi/core
```

---

## Usage

### 1. Attaching to Shukoi Actions

```typescript
import { createDefaultConfig } from '@shukoi/core';
import { createOpenTelemetryPlugin } from '@shukoi/otel';
import { orderAction } from './actions/order.js';

const otelPlugin = createOpenTelemetryPlugin({
  serviceName: 'order-service',
  serviceVersion: '1.0.3',
  exporter: 'otlp',
  otlpEndpoint: 'https://collector.example.com/v1/traces',
});

const config = createDefaultConfig({
  plugins: [otelPlugin],
});
```

### 2. Scraping Prometheus Metrics in Self-Host

```typescript
import { createRestRouter } from '@shukoi/api';
import { createSelfHostServer } from '@shukoi/selfhost';
import { createPrometheusRegistry } from '@shukoi/otel/prometheus';
import { config } from './config.js';

const registry = createPrometheusRegistry();
const app = createRestRouter([orderAction], config);

// Expose /metrics endpoint for Prometheus scrapers
app.get('/metrics', (c) => {
  return c.text(registry.scrape(), 200, {
    'Content-Type': 'text/plain; version=0.0.4',
  });
});

export const server = createSelfHostServer(app, config);
```

---

## License

MIT © [shukoilab](https://github.com/shukoilab)
