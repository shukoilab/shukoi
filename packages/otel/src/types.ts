/**
 * @purpose Core type definitions for OpenTelemetry distributed tracing and metrics in Shukoi.
 * @rationale Provides typed contracts for spans, trace context, metrics, and exporters with zero external SDK bloat.
 * @preconditions None.
 * @invariants Pure TypeScript interfaces and types; zero runtime overhead.
 */

/**
 * @purpose W3C TraceContext parsed representation.
 * @rationale Conforms to W3C TraceContext recommendation (traceparent header specification).
 * @invariants Validated 32-hex traceId, 16-hex parentSpanId, and 2-hex traceFlags.
 */
export interface TraceParent {
  readonly version: string;
  readonly traceId: string;
  readonly parentSpanId: string;
  readonly traceFlags: string;
}

/**
 * @purpose Permitted attribute values for OpenTelemetry spans and metrics.
 * @rationale Adheres to OTel semantic conventions allowing primitives and string arrays.
 * @invariants Primitive or array of primitives.
 */
export type SpanAttributeValue = string | number | boolean | readonly string[] | readonly number[];

/**
 * @purpose Strongly-typed key-value attributes for telemetry records.
 * @rationale Enables contextual metadata recording without loose untyped objects.
 * @invariants String keys; typed attribute values.
 */
export type SpanAttributes = Record<string, SpanAttributeValue | undefined>;

/**
 * @purpose Lifecycle status of an OpenTelemetry span.
 * @rationale Corresponds to OpenTelemetry StatusCode (UNSET, OK, ERROR).
 * @invariants String union.
 */
export type SpanStatusCode = 'UNSET' | 'OK' | 'ERROR';

/**
 * @purpose Status outcome for a completed span.
 * @rationale Carries status code and optional descriptive error message.
 * @invariants Immutable structure.
 */
export interface SpanStatus {
  readonly code: SpanStatusCode;
  readonly message?: string | undefined;
}

/**
 * @purpose OpenTelemetry standard SpanKind classification.
 * @rationale Categorizes span relationship within distributed systems (1=INTERNAL, 2=SERVER, 3=CLIENT, 4=PRODUCER, 5=CONSUMER).
 * @invariants String union conforming to OpenTelemetry specification.
 */
export type SpanKind = 'INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER';

/**
 * @purpose Materialized immutable record of a completed span ready for export.
 * @rationale Decoupled snapshot of span execution history.
 * @invariants Immutable data transfer object.
 */
export interface SpanRecord {
  readonly name: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string | undefined;
  readonly kind?: SpanKind | undefined;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly durationMs: number;
  readonly status: SpanStatus;
  readonly attributes: Readonly<Record<string, SpanAttributeValue>>;
}

/**
 * @purpose OpenTelemetry span exporter interface.
 * @rationale Pluggable sink for exporting spans to remote collectors or in-memory arrays.
 * @invariants Non-blocking export method; thread-safe.
 */
export interface SpanExporter {
  export(spans: readonly SpanRecord[]): Promise<void>;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * @purpose Recorded snapshot of a metric series.
 * @rationale Represents Prometheus or OTel metric data points.
 * @invariants Immutable snapshot.
 */
export interface MetricDataPoint {
  readonly name: string;
  readonly type: 'counter' | 'gauge' | 'histogram';
  readonly help: string;
  readonly value: number;
  readonly labels: Readonly<Record<string, string>>;
  readonly timestampMs: number;
  readonly buckets?: ReadonlyArray<{ readonly le: number; readonly count: number }> | undefined;
  readonly sum?: number | undefined;
  readonly count?: number | undefined;
}

/**
 * @purpose Configuration options for OpenTelemetry plugin initialization.
 * @rationale Configures service identifiers, exporter sinks, and ring buffer ceilings.
 * @invariants Bounded buffer caps.
 */
export interface OpenTelemetryPluginConfig {
  readonly serviceName: string;
  readonly serviceVersion?: string | undefined;
  readonly exporter?: SpanExporter | undefined;
  readonly maxQueueSize?: number | undefined;
  readonly batchSize?: number | undefined;
  readonly redactKeys?: readonly string[] | undefined;
}
