/**
 * @purpose OpenTelemetry compatible metrics engine (Counter, UpDownCounter, Histogram).
 * @rationale High-performance, zero-dependency metrics aggregation suitable for Prometheus and OTLP.
 * @preconditions None.
 * @invariants Pure in-memory maps; O(1) observation time; bounded memory footprint.
 */

import type { MetricDataPoint } from './types.js';

/**
 * @purpose Serializes labels object into a deterministic sorted cache key string.
 * @rationale Ensures label key-order differences do not duplicate metric series.
 * @param labels Key-value record of metric labels.
 * @returns Deterministic string identifier.
 * @invariants Big-O O(k log k) where k is label count; deterministic string representation.
 */
function serializeLabels(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}="${labels[k]}"`).join(',');
}

/**
 * @purpose Monotonically increasing Counter metric.
 * @rationale Tracks discrete events such as total action executions or error counts.
 * @invariants Value cannot decrease; thread-safe increments.
 */
export class Counter {
  public readonly name: string;
  public readonly description: string;
  private readonly series: Map<string, { value: number; labels: Record<string, string> }> =
    new Map();

  /**
   * @purpose Initializes a new Counter metric.
   * @param name Metric name string.
   * @param description Metric help text.
   * @invariants Big-O O(1).
   */
  public constructor(name: string, description: string) {
    this.name = name;
    this.description = description;
  }

  /**
   * @purpose Increments the counter by a specified positive amount.
   * @param amount Positive numeric value to add (default 1).
   * @param labels Dimension labels.
   * @invariants Rejects negative amounts.
   */
  public inc(amount = 1, labels: Record<string, string> = {}): void {
    if (amount < 0) {
      return;
    }
    const key = serializeLabels(labels);
    const existing = this.series.get(key);
    if (existing) {
      existing.value += amount;
    } else {
      this.series.set(key, { value: amount, labels: { ...labels } });
    }
  }

  /**
   * @purpose Collects all metric data points for export.
   * @returns Array of MetricDataPoint snapshots.
   */
  public collect(): MetricDataPoint[] {
    const now = Date.now();
    const points: MetricDataPoint[] = [];
    for (const item of this.series.values()) {
      points.push({
        name: this.name,
        type: 'counter',
        help: this.description,
        value: item.value,
        labels: Object.freeze(item.labels),
        timestampMs: now,
      });
    }
    return points;
  }
}

/**
 * @purpose UpDownCounter / Gauge metric that can increase or decrease.
 * @rationale Tracks concurrent in-flight requests or active worker pools.
 * @invariants Unbounded signed value.
 */
export class UpDownCounter {
  public readonly name: string;
  public readonly description: string;
  private readonly series: Map<string, { value: number; labels: Record<string, string> }> =
    new Map();

  public constructor(name: string, description: string) {
    this.name = name;
    this.description = description;
  }

  public add(amount: number, labels: Record<string, string> = {}): void {
    const key = serializeLabels(labels);
    const existing = this.series.get(key);
    if (existing) {
      existing.value += amount;
    } else {
      this.series.set(key, { value: amount, labels: { ...labels } });
    }
  }

  public collect(): MetricDataPoint[] {
    const now = Date.now();
    const points: MetricDataPoint[] = [];
    for (const item of this.series.values()) {
      points.push({
        name: this.name,
        type: 'gauge',
        help: this.description,
        value: item.value,
        labels: Object.freeze(item.labels),
        timestampMs: now,
      });
    }
    return points;
  }
}

/**
 * @purpose Default latency histogram buckets in milliseconds.
 * @rationale Standard exponential distribution for web request latencies.
 */
export const DEFAULT_LATENCY_BUCKETS: readonly number[] = Object.freeze([
  5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
]);

/**
 * @purpose Histogram metric tracking distribution of values into discrete buckets.
 * @rationale Aggregates latency distributions, calculating count, sum, and quantile bounds.
 * @invariants Cumulative bucket counts; non-negative values.
 */
export class Histogram {
  public readonly name: string;
  public readonly description: string;
  private readonly buckets: readonly number[];
  private readonly series: Map<
    string,
    {
      count: number;
      sum: number;
      bucketCounts: number[];
      labels: Record<string, string>;
    }
  > = new Map();

  public constructor(name: string, description: string, buckets = DEFAULT_LATENCY_BUCKETS) {
    this.name = name;
    this.description = description;
    this.buckets = [...buckets].sort((a, b) => a - b);
  }

  public record(value: number, labels: Record<string, string> = {}): void {
    if (value < 0) {
      return;
    }
    const key = serializeLabels(labels);
    let entry = this.series.get(key);
    if (!entry) {
      entry = {
        count: 0,
        sum: 0,
        bucketCounts: new Array(this.buckets.length).fill(0),
        labels: { ...labels },
      };
      this.series.set(key, entry);
    }

    entry.count += 1;
    entry.sum += value;

    for (let i = 0; i < this.buckets.length; i++) {
      const bound = this.buckets[i];
      if (bound !== undefined && value <= bound) {
        entry.bucketCounts[i] = (entry.bucketCounts[i] ?? 0) + 1;
      }
    }
  }

  public collect(): MetricDataPoint[] {
    const now = Date.now();
    const points: MetricDataPoint[] = [];

    for (const item of this.series.values()) {
      const buckets: Array<{ le: number; count: number }> = [];
      for (let i = 0; i < this.buckets.length; i++) {
        const bound = this.buckets[i];
        if (bound !== undefined) {
          buckets.push({
            le: bound,
            count: item.bucketCounts[i] ?? 0,
          });
        }
      }

      points.push({
        name: this.name,
        type: 'histogram',
        help: this.description,
        value: item.count,
        count: item.count,
        sum: item.sum,
        buckets: Object.freeze(buckets),
        labels: Object.freeze(item.labels),
        timestampMs: now,
      });
    }

    return points;
  }
}

/**
 * @purpose Registry collecting and managing all active metrics for an application.
 * @rationale Centralized coordinator for Prometheus scraping and OTLP metrics push.
 * @invariants Bounded set of named metrics; thread-safe.
 */
export class MetricsRegistry {
  private readonly counters: Map<string, Counter> = new Map();
  private readonly gauges: Map<string, UpDownCounter> = new Map();
  private readonly histograms: Map<string, Histogram> = new Map();

  public getOrCreateCounter(name: string, description: string): Counter {
    let metric = this.counters.get(name);
    if (!metric) {
      metric = new Counter(name, description);
      this.counters.set(name, metric);
    }
    return metric;
  }

  public getOrCreateUpDownCounter(name: string, description: string): UpDownCounter {
    let metric = this.gauges.get(name);
    if (!metric) {
      metric = new UpDownCounter(name, description);
      this.gauges.set(name, metric);
    }
    return metric;
  }

  public getOrCreateHistogram(
    name: string,
    description: string,
    buckets = DEFAULT_LATENCY_BUCKETS,
  ): Histogram {
    let metric = this.histograms.get(name);
    if (!metric) {
      metric = new Histogram(name, description, buckets);
      this.histograms.set(name, metric);
    }
    return metric;
  }

  public collect(): MetricDataPoint[] {
    const result: MetricDataPoint[] = [];
    for (const c of this.counters.values()) {
      result.push(...c.collect());
    }
    for (const g of this.gauges.values()) {
      result.push(...g.collect());
    }
    for (const h of this.histograms.values()) {
      result.push(...h.collect());
    }
    return result;
  }
}
