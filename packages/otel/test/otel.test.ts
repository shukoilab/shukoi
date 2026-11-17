/**
 * @purpose Unit and integration test suite for @shukoi/otel.
 * @rationale Validates OpenTelemetry tracing lifecycle, W3C correlation extraction, Prometheus serialization, and ring buffer backpressure.
 * @preconditions None.
 * @invariants Pure in-memory assertions; zero network side effects.
 */

import { createDefaultConfig, DomainError, defineAction, executeAction } from '@shukoi/core';
import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';
import { OtlpHttpSpanExporter } from '../src/edge.js';
import { createOpenTelemetryPlugin } from '../src/index.js';
import { PrometheusRegistry } from '../src/prometheus.js';
import { MockSpanExporter } from '../src/testing.js';
import { parseTraceParent, serializeTraceParent, Tracer } from '../src/tracer.js';

describe('@shukoi/otel OpenTelemetry & Prometheus Integration', () => {
  it('parses valid W3C traceparent and rejects malformed values', () => {
    const valid = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const parsed = parseTraceParent(valid);
    expect(parsed).not.toBeNull();
    expect(parsed?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(parsed?.parentSpanId).toBe('00f067aa0ba902b7');
    expect(parsed?.traceFlags).toBe('01');

    // Reject all zeros
    expect(parseTraceParent('00-00000000000000000000000000000000-00f067aa0ba902b7-01')).toBeNull();
    // Reject malformed version
    expect(parseTraceParent('ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeNull();
    // Reject invalid lengths
    expect(parseTraceParent('00-short-short-01')).toBeNull();
    expect(parseTraceParent(null)).toBeNull();

    const serialized = serializeTraceParent('4bf92f3577b34da6a3ce929d0e0e4736', '00f067aa0ba902b7');
    expect(serialized).toBe(valid);
  });

  it('instruments action executions with child spans linked to incoming traceparent', async () => {
    const mockExporter = new MockSpanExporter();
    const otelPlugin = createOpenTelemetryPlugin({
      serviceName: 'test-service',
      serviceVersion: '1.0.4',
      exporter: mockExporter,
    });

    const testAction = defineAction({
      name: 'calculateTax',
      description: 'Calculates tax amount',
      authRequired: false,
      input: Type.Object({ amount: Type.Number() }),
      output: Type.Object({ tax: Type.Number() }),
      async handler(input) {
        return { tax: input.amount * 0.1 };
      },
    });

    const config = createDefaultConfig({
      plugins: [otelPlugin],
    });

    const traceHeader = '00-11112222333344445555666677778888-aaaabbbbccccdddd-01';
    const result = await executeAction(
      testAction,
      { amount: 100 },
      {
        config,
        transport: 'rest',
        headers: { traceparent: traceHeader },
        plugins: [otelPlugin],
      },
    );

    expect(result.tax).toBe(10);
    await otelPlugin.flush();

    const spans = mockExporter.getFinishedSpans();
    expect(spans.length).toBe(1);

    const span = spans[0];
    expect(span?.name).toBe('shukoi.action.calculateTax');
    expect(span?.traceId).toBe('11112222333344445555666677778888');
    expect(span?.parentSpanId).toBe('aaaabbbbccccdddd');
    expect(span?.status.code).toBe('OK');
    expect(span?.attributes['shukoi.action.name']).toBe('calculateTax');
    expect(span?.attributes['shukoi.transport']).toBe('rest');
    expect(span?.attributes['service.name']).toBe('test-service');
  });

  it('captures error attributes and failure status when an action throws DomainError', async () => {
    const mockExporter = new MockSpanExporter();
    const otelPlugin = createOpenTelemetryPlugin({
      serviceName: 'test-service',
      exporter: mockExporter,
    });

    const failingAction = defineAction({
      name: 'failOp',
      description: 'Fails with domain conflict',
      authRequired: false,
      input: Type.Object({}),
      output: Type.Object({ ok: Type.Boolean() }),
      async handler() {
        throw new DomainError('CONFLICT', 'Resource already locked', 409);
      },
    });

    const config = createDefaultConfig({
      plugins: [otelPlugin],
    });

    await expect(
      executeAction(
        failingAction,
        {},
        {
          config,
          transport: 'mcp-http',
          plugins: [otelPlugin],
        },
      ),
    ).rejects.toThrow(DomainError);

    await otelPlugin.flush();
    const spans = mockExporter.getFinishedSpans();
    expect(spans.length).toBe(1);

    const span = spans[0];
    expect(span?.name).toBe('shukoi.action.failOp');
    expect(span?.status.code).toBe('ERROR');
    expect(span?.status.message).toBe('Resource already locked');
    expect(span?.attributes['shukoi.error.code']).toBe('CONFLICT');
  });

  it('enforces O(1) memory bounds by dropping oldest spans when queue exceeds maxQueueSize', () => {
    const tracer = new Tracer({
      serviceName: 'bounded-test',
      maxQueueSize: 5,
    });

    for (let i = 0; i < 12; i++) {
      const span = tracer.startSpan(`operation_${i}`);
      span.setAttribute('index', i);
      span.end();
    }

    // Queue must never exceed 5 items
    expect(tracer.getQueueLength()).toBe(5);
  });

  it('serializes metric data points to standard Prometheus text exposition format', () => {
    const otelPlugin = createOpenTelemetryPlugin({
      serviceName: 'prom-test',
    });

    const prom = new PrometheusRegistry(otelPlugin.metrics);
    const counter = otelPlugin.metrics.getOrCreateCounter('test_events_total', 'Total test events');
    counter.inc(5, { env: 'prod' });

    const hist = otelPlugin.metrics.getOrCreateHistogram(
      'test_latency_ms',
      'Test latency in ms',
      [10, 50, 100],
    );
    hist.record(25, { handler: 'test' });
    hist.record(75, { handler: 'test' });

    const scrapeOutput = prom.scrape();
    expect(scrapeOutput).toContain('# HELP test_events_total Total test events');
    expect(scrapeOutput).toContain('# TYPE test_events_total counter');
    expect(scrapeOutput).toContain('test_events_total{env="prod"} 5');
    expect(scrapeOutput).toContain('# TYPE test_latency_ms histogram');
    expect(scrapeOutput).toContain('test_latency_ms_bucket{handler="test",le="50"} 1');
    expect(scrapeOutput).toContain('test_latency_ms_bucket{handler="test",le="100"} 2');
    expect(scrapeOutput).toContain('test_latency_ms_count{handler="test"} 2');
  });

  it('exports spans via OtlpHttpSpanExporter without unhandled rejection on failure', async () => {
    const exporter = new OtlpHttpSpanExporter({
      endpoint: 'http://127.0.0.1:65534/v1/traces',
      timeoutMs: 100,
    });

    // Should complete cleanly without crashing host process
    await expect(
      exporter.export([
        {
          name: 'test',
          traceId: '11112222333344445555666677778888',
          spanId: 'aaaabbbbccccdddd',
          startTimeMs: 1000,
          endTimeMs: 1050,
          durationMs: 50,
          status: { code: 'OK' },
          attributes: { key: 'value' },
        },
      ]),
    ).resolves.not.toThrow();
  });

  it('records exceptions conforming to OpenTelemetry semantic conventions', () => {
    const tracer = new Tracer({ serviceName: 'test-service' });
    const span = tracer.startSpan('failingOp', null, 'SERVER');
    expect(span.kind).toBe('SERVER');

    const err = new Error('Database connection refused');
    span.recordException(err);
    span.end();

    const record = tracer.getQueue()[0];
    expect(record?.status.code).toBe('ERROR');
    expect(record?.status.message).toBe('Database connection refused');
    expect(record?.attributes['exception.type']).toBe('Error');
    expect(record?.attributes['exception.message']).toBe('Database connection refused');
    expect(record?.attributes['exception.stacktrace']).toBeDefined();
    expect(record?.kind).toBe('SERVER');
  });

  it('formats OTLP/HTTP payload with service.name under resource.attributes', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
        return new Response(JSON.stringify({}), { status: 200 });
      }) as typeof fetch;

      const exporter = new OtlpHttpSpanExporter({
        endpoint: 'http://collector:4318/v1/traces',
        serviceName: 'my-payment-api',
        resourceAttributes: { 'deployment.environment': 'staging' },
      });

      await exporter.export([
        {
          name: 'checkout',
          traceId: '11112222333344445555666677778888',
          spanId: 'aaaabbbbccccdddd',
          kind: 'SERVER',
          startTimeMs: 1000,
          endTimeMs: 1100,
          durationMs: 100,
          status: { code: 'OK' },
          attributes: { 'http.status_code': 200 },
        },
      ]);

      expect(capturedBody).toBeDefined();
      const resourceSpans = (
        capturedBody as {
          resourceSpans: Array<{
            resource: { attributes: Array<{ key: string; value: { stringValue: string } }> };
            scopeSpans: Array<{ spans: Array<{ kind: number }> }>;
          }>;
        }
      ).resourceSpans;
      const resource = resourceSpans[0]?.resource;
      expect(resource?.attributes).toContainEqual({
        key: 'service.name',
        value: { stringValue: 'my-payment-api' },
      });
      expect(resource?.attributes).toContainEqual({
        key: 'deployment.environment',
        value: { stringValue: 'staging' },
      });

      const span = resourceSpans[0]?.scopeSpans[0]?.spans[0];
      expect(span?.kind).toBe(2); // SPAN_KIND_SERVER
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
