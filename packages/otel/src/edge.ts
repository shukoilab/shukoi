/**
 * @purpose Pure Web-standard OTLP/HTTP JSON span exporter for Edge runtimes (Cloudflare Workers, Lambda, Node).
 * @rationale Delivers OpenTelemetry spans to collectors via standard fetch with zero node:* imports.
 * @preconditions Valid collector endpoint URL.
 * @invariants Pure Web standards; 100% compatible with V8 Isolates; resilient error handling.
 */

import type { SpanExporter, SpanRecord } from './types.js';

/**
 * @purpose Configuration options for OtlpHttpSpanExporter.
 * @rationale Configures target collector URL, headers, and request timeout.
 * @invariants Typed configuration.
 */
export interface OtlpHttpExporterOptions {
  readonly endpoint: string;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly timeoutMs?: number | undefined;
}

/**
 * @purpose Converts internal SpanRecord to OpenTelemetry OTLP JSON format.
 * @param span Internal SpanRecord snapshot.
 * @returns OTLP JSON span representation.
 * @invariants Conforms to OTLP/HTTP JSON specification v1.
 */
function toOtlpJsonSpan(span: SpanRecord): Record<string, unknown> {
  const attributes = Object.entries(span.attributes).map(([key, val]) => {
    if (typeof val === 'string') {
      return { key, value: { stringValue: val } };
    }
    if (typeof val === 'number') {
      return Number.isInteger(val)
        ? { key, value: { intValue: String(val) } }
        : { key, value: { doubleValue: val } };
    }
    if (typeof val === 'boolean') {
      return { key, value: { boolValue: val } };
    }
    return { key, value: { stringValue: JSON.stringify(val) } };
  });

  return {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId ?? '',
    name: span.name,
    kind: 1, // SPAN_KIND_INTERNAL
    startTimeUnixNano: String(BigInt(span.startTimeMs) * 1_000_000n),
    endTimeUnixNano: String(BigInt(span.endTimeMs) * 1_000_000n),
    attributes,
    status: {
      code: span.status.code === 'OK' ? 1 : span.status.code === 'ERROR' ? 2 : 0,
      message: span.status.message ?? '',
    },
  };
}

/**
 * @purpose Web-standard OTLP/HTTP JSON span exporter implementation.
 * @rationale Uses fetch() with timeout signal; zero node:* imports.
 * @invariants Thread-safe across concurrent async tasks; non-blocking.
 */
export class OtlpHttpSpanExporter implements SpanExporter {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  public constructor(options: OtlpHttpExporterOptions) {
    this.endpoint = options.endpoint;
    this.headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  /**
   * @purpose Exports a batch of completed span records over HTTP.
   * @param spans Batch of SpanRecords.
   * @returns Promise resolving when HTTP POST completes.
   * @throws Never throws unhandled; logs or suppresses network failure.
   */
  public async export(spans: readonly SpanRecord[]): Promise<void> {
    if (spans.length === 0) {
      return;
    }

    const payload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              scope: { name: 'shukoi.otel', version: '1.0.3' },
              spans: spans.map(toOtlpJsonSpan),
            },
          ],
        },
      ],
    };

    try {
      const signal = AbortSignal.timeout(this.timeoutMs);
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(payload),
        signal,
      });

      if (!res.ok) {
        // Collector error: suppress to avoid crashing host application
      }
    } catch {
      // Network failure or timeout: silently suppress
    }
  }

  public async flush(): Promise<void> {
    // Stateless HTTP exporter; buffers are flushed immediately
  }

  public async shutdown(): Promise<void> {
    // No background socket connections to close
  }
}
