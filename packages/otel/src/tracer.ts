/**
 * @purpose Core OpenTelemetry Tracer, Span lifecycle manager, and W3C TraceContext parser.
 * @rationale Manages span tree hierarchies, correlation IDs, and bounded memory ring buffers without external SDKs.
 * @preconditions Valid OpenTelemetryPluginConfig.
 * @invariants Pure Web Crypto primitives; O(1) ring buffer memory bounds; thread-safe across concurrent async operations.
 */

import type {
  OpenTelemetryPluginConfig,
  SpanAttributes,
  SpanAttributeValue,
  SpanExporter,
  SpanRecord,
  SpanStatus,
  TraceParent,
} from './types.js';

/**
 * @purpose Generates a cryptographically secure 32-character hexadecimal trace ID (16 random bytes).
 * @rationale Conforms to W3C TraceContext trace-id specification.
 * @preconditions None.
 * @returns 32-character lowercase hex string.
 * @throws Never throws.
 * @invariants Big-O O(1) time complexity; uses crypto.getRandomValues.
 */
export function generateTraceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @purpose Generates a cryptographically secure 16-character hexadecimal span ID (8 random bytes).
 * @rationale Conforms to W3C TraceContext parent-id specification.
 * @preconditions None.
 * @returns 16-character lowercase hex string.
 * @throws Never throws.
 * @invariants Big-O O(1) time complexity; uses crypto.getRandomValues.
 */
export function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @purpose Parses an incoming W3C traceparent header string.
 * @rationale Validates format `version-trace_id-parent_id-trace_flags` per W3C specification.
 * @preconditions header is an optional string.
 * @param header Raw header value from transport.
 * @returns Parsed TraceParent object, or null if missing or malformed.
 * @throws Never throws.
 * @invariants Big-O O(1) string parsing; validates 00 version, 32-hex traceId, and 16-hex parentSpanId.
 */
export function parseTraceParent(header?: string | null): TraceParent | null {
  if (!header || typeof header !== 'string') {
    return null;
  }
  const parts = header.trim().split('-');
  if (parts.length < 4) {
    return null;
  }
  const [version, traceId, parentSpanId, traceFlags] = parts;
  if (!version || !traceId || !parentSpanId || !traceFlags) {
    return null;
  }
  if (version !== '00') {
    return null;
  }
  if (!/^[a-f0-9]{32}$/.test(traceId) || traceId === '00000000000000000000000000000000') {
    return null;
  }
  if (!/^[a-f0-9]{16}$/.test(parentSpanId) || parentSpanId === '0000000000000000') {
    return null;
  }
  if (!/^[a-f0-9]{2}$/.test(traceFlags)) {
    return null;
  }

  return {
    version,
    traceId,
    parentSpanId,
    traceFlags,
  };
}

/**
 * @purpose Serializes a W3C traceparent header string.
 * @rationale Standardizes header emission for outbound RPC or HTTP responses.
 * @preconditions traceId and spanId must be valid hex strings.
 * @param traceId 32-hex trace identifier.
 * @param spanId 16-hex span identifier.
 * @param sampled Optional boolean indicating whether span is sampled (default true).
 * @returns W3C traceparent string.
 * @throws Never throws.
 * @invariants Big-O O(1) string interpolation.
 */
export function serializeTraceParent(traceId: string, spanId: string, sampled = true): string {
  const flags = sampled ? '01' : '00';
  return `00-${traceId}-${spanId}-${flags}`;
}

/**
 * @purpose Active span object representing an in-flight operation.
 * @rationale Allows recording metadata, tags, and outcomes before completing a telemetry record.
 * @invariants Thread-safe within async execution; immutable post-end().
 */
export class Span {
  public readonly name: string;
  public readonly traceId: string;
  public readonly spanId: string;
  public readonly parentSpanId?: string | undefined;
  public readonly startTimeMs: number;
  private endTimeMs?: number | undefined;
  private status: SpanStatus = { code: 'UNSET' };
  private readonly attributes: Map<string, SpanAttributeValue> = new Map();
  private readonly onEnd: (record: SpanRecord) => void;

  /**
   * @purpose Initializes a new active Span instance.
   * @rationale Binds correlation IDs, timestamps, and completion callback.
   * @param name Descriptive span operation name.
   * @param traceId Global 32-hex trace ID.
   * @param spanId Unique 16-hex span ID.
   * @param parentSpanId Optional parent 16-hex span ID.
   * @param onEnd Callback invoked once span ends.
   * @returns Span instance.
   * @throws Never throws.
   * @invariants Big-O O(1) constructor.
   */
  public constructor(
    name: string,
    traceId: string,
    spanId: string,
    parentSpanId: string | undefined,
    onEnd: (record: SpanRecord) => void,
  ) {
    this.name = name;
    this.traceId = traceId;
    this.spanId = spanId;
    this.parentSpanId = parentSpanId;
    this.startTimeMs = Date.now();
    this.onEnd = onEnd;
  }

  /**
   * @purpose Sets an attribute on the active span.
   * @rationale Enforces typed primitive and array values.
   * @param key Attribute name string.
   * @param value Valid attribute value.
   * @returns Current Span instance for method chaining.
   * @throws Never throws.
   * @invariants Big-O O(1) Map insertion.
   */
  public setAttribute(key: string, value: SpanAttributeValue | undefined): this {
    if (this.endTimeMs !== undefined || value === undefined) {
      return this;
    }
    this.attributes.set(key, value);
    return this;
  }

  /**
   * @purpose Sets multiple attributes in bulk on the active span.
   * @rationale Efficient bulk population of span metadata.
   * @param attributes Key-value map of attributes.
   * @returns Current Span instance.
   * @throws Never throws.
   * @invariants Big-O O(k) where k is attribute count.
   */
  public setAttributes(attributes: SpanAttributes): this {
    if (this.endTimeMs !== undefined) {
      return this;
    }
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) {
        this.attributes.set(key, value);
      }
    }
    return this;
  }

  /**
   * @purpose Sets the final outcome status of the span.
   * @rationale Marks span as OK or ERROR with optional description.
   * @param code Span status code (OK, ERROR, UNSET).
   * @param message Optional error description.
   * @returns Current Span instance.
   * @throws Never throws.
   * @invariants Big-O O(1).
   */
  public setStatus(code: SpanStatus['code'], message?: string): this {
    if (this.endTimeMs !== undefined) {
      return this;
    }
    this.status = { code, message };
    return this;
  }

  /**
   * @purpose Completes span execution and delivers materialized record to tracer.
   * @rationale Idempotent method capturing final endTimeMs and duration.
   * @param endTimeMs Optional override timestamp in milliseconds.
   * @returns void
   * @throws Never throws.
   * @invariants Big-O O(1); idempotent (second call is a no-op).
   */
  public end(endTimeMs?: number): void {
    if (this.endTimeMs !== undefined) {
      return;
    }
    this.endTimeMs = endTimeMs ?? Date.now();
    const durationMs = Math.max(0, this.endTimeMs - this.startTimeMs);

    const attrRecord: Record<string, SpanAttributeValue> = {};
    for (const [k, v] of this.attributes.entries()) {
      attrRecord[k] = v;
    }

    const record: SpanRecord = Object.freeze({
      name: this.name,
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      startTimeMs: this.startTimeMs,
      endTimeMs: this.endTimeMs,
      durationMs,
      status: Object.freeze(this.status),
      attributes: Object.freeze(attrRecord),
    });

    this.onEnd(record);
  }
}

/**
 * @purpose OpenTelemetry Tracer managing active spans, bounded queues, and background flushing.
 * @rationale Implements drop-oldest circular ring buffer guaranteeing O(1) memory bound under failure.
 * @invariants Bounded queue cap (maxQueueSize); thread-safe.
 */
export class Tracer {
  private readonly config: OpenTelemetryPluginConfig;
  private readonly exporter?: SpanExporter | undefined;
  private readonly queue: SpanRecord[] = [];
  private readonly maxQueueSize: number;
  private readonly batchSize: number;
  private isFlushing = false;

  /**
   * @purpose Initializes Tracer with runtime configuration and buffer bounds.
   * @rationale Sets up bounded queue and optional exporter sink.
   * @param config Telemetry configuration parameters.
   * @returns Tracer instance.
   * @throws Never throws.
   * @invariants Enforces maxQueueSize defaults (2048) and batchSize (512).
   */
  public constructor(config: OpenTelemetryPluginConfig) {
    this.config = config;
    this.exporter = config.exporter;
    this.maxQueueSize = config.maxQueueSize ?? 2048;
    this.batchSize = config.batchSize ?? 512;
  }

  /**
   * @purpose Starts a new active span linked to optional parent context.
   * @rationale Generates child span or fresh root span adhering to W3C TraceContext.
   * @param name Descriptive operation name.
   * @param parentContext Optional parsed parent trace context or traceparent header.
   * @returns Newly created active Span.
   * @throws Never throws.
   * @invariants Big-O O(1).
   */
  public startSpan(name: string, parentContext?: TraceParent | string | null): Span {
    let traceId: string;
    let parentSpanId: string | undefined;

    const parsed =
      typeof parentContext === 'string' ? parseTraceParent(parentContext) : (parentContext ?? null);

    if (parsed) {
      traceId = parsed.traceId;
      parentSpanId = parsed.parentSpanId;
    } else {
      traceId = generateTraceId();
    }

    const spanId = generateSpanId();

    const span = new Span(name, traceId, spanId, parentSpanId, (record) => {
      this.enqueueSpan(record);
    });

    span.setAttribute('service.name', this.config.serviceName);
    if (this.config.serviceVersion) {
      span.setAttribute('service.version', this.config.serviceVersion);
    }

    return span;
  }

  /**
   * @purpose Enqueues a completed span record with drop-oldest backpressure eviction.
   * @rationale Drops oldest spans when buffer exceeds maxQueueSize, guaranteeing zero OOM memory leaks.
   * @param record Materialized SpanRecord.
   * @returns void
   * @throws Never throws.
   * @invariants Big-O O(1) amortized queue push with drop-oldest eviction.
   */
  private enqueueSpan(record: SpanRecord): void {
    if (this.queue.length >= this.maxQueueSize) {
      // Drop oldest span to preserve O(1) space ceiling
      this.queue.shift();
    }
    this.queue.push(record);

    if (this.exporter && this.queue.length >= this.batchSize) {
      void this.flush();
    }
  }

  /**
   * @purpose Flushes queued spans to the configured exporter.
   * @rationale Asynchronously drains spans up to batchSize without blocking event loop.
   * @returns Promise resolving when active flush completes.
   * @throws Never throws unhandled.
   * @invariants Non-overlapping single-flight execution; drains queue in batches.
   */
  public async flush(): Promise<void> {
    if (this.isFlushing || !this.exporter || this.queue.length === 0) {
      return;
    }
    this.isFlushing = true;
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.batchSize);
        await this.exporter.export(batch);
      }
      await this.exporter.flush();
    } catch {
      // Telemetry errors must never crash host application
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * @purpose Returns current count of queued spans awaiting export.
   * @rationale Useful for health probes, telemetry inspection, and tests.
   * @returns Current queue length.
   * @throws Never throws.
   * @invariants Big-O O(1).
   */
  public getQueueLength(): number {
    return this.queue.length;
  }
}
