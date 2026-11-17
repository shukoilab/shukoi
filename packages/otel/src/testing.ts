/**
 * @purpose In-memory test doubles and mock exporters for OpenTelemetry unit and integration testing.
 * @rationale Enables deterministic assertions on span lifecycles and metric recordings without network I/O.
 * @preconditions None.
 * @invariants Pure in-memory arrays; thread-safe across concurrent tests.
 */

import type { MetricsRegistry } from './metrics.js';
import type { MetricDataPoint, SpanExporter, SpanRecord } from './types.js';

/**
 * @purpose In-memory mock span exporter storing finished spans for test assertions.
 * @rationale Captures exported spans and provides inspection helpers without network traffic.
 * @invariants Thread-safe append; provides getFinishedSpans() and clear().
 */
export class MockSpanExporter implements SpanExporter {
  private finishedSpans: SpanRecord[] = [];

  public async export(spans: readonly SpanRecord[]): Promise<void> {
    this.finishedSpans.push(...spans);
  }

  public async flush(): Promise<void> {
    // No-op for in-memory double
  }

  public async shutdown(): Promise<void> {
    this.finishedSpans = [];
  }

  /**
   * @purpose Returns a readonly array of all captured spans.
   * @returns Readonly copy of finished spans array.
   */
  public getFinishedSpans(): readonly SpanRecord[] {
    return [...this.finishedSpans];
  }

  /**
   * @purpose Clears all captured spans.
   * @returns void
   */
  public clear(): void {
    this.finishedSpans = [];
  }
}

/**
 * @purpose In-memory metric reader for testing metric state transitions.
 * @rationale Exposes collected data points for unit test assertions.
 * @invariants Pure read-only inspection.
 */
export class MockMetricReader {
  private readonly registry: MetricsRegistry;

  public constructor(registry: MetricsRegistry) {
    this.registry = registry;
  }

  public getMetric(name: string): readonly MetricDataPoint[] {
    return this.registry.collect().filter((p) => p.name === name);
  }

  public getAllMetrics(): readonly MetricDataPoint[] {
    return this.registry.collect();
  }
}
