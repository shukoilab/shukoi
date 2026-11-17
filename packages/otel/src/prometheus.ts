/**
 * @purpose Zero-dependency Prometheus text exposition format serializer.
 * @rationale Formats aggregated metrics into standard Prometheus exposition format without external dependencies.
 * @preconditions MetricsRegistry populated with counters, gauges, or histograms.
 * @invariants Pure string concatenation; deterministic output format conforming to Prometheus 0.0.4.
 */

import type { MetricsRegistry } from './metrics.js';
import type { MetricDataPoint } from './types.js';

/**
 * @purpose Formats label object into Prometheus label string format `{key="val",key2="val2"}`.
 * @param labels Key-value pairs.
 * @returns Formatted label string or empty string if labels object is empty.
 * @invariants Escapes quotes, backslashes, and newlines in label values.
 */
function formatPrometheusLabels(labels: Readonly<Record<string, string>>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) {
    return '';
  }
  const formatted = entries
    .map(
      ([k, v]) => `${k}="${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
    )
    .join(',');
  return `{${formatted}}`;
}

/**
 * @purpose Serializes metric data points into standard Prometheus 0.0.4 text exposition string.
 * @rationale Renders # HELP and # TYPE headers and groups time-series value lines by metric family.
 * @param dataPoints Array of collected MetricDataPoint records.
 * @returns Multi-line text string ending with newline.
 * @throws Never throws.
 * @invariants Big-O O(N) over metric series count; guarantees contiguous metric family grouping.
 */
export function serializeToPrometheusText(dataPoints: readonly MetricDataPoint[]): string {
  const lines: string[] = [];

  // Group data points by metric name to guarantee contiguous metric family emission
  const grouped = new Map<string, MetricDataPoint[]>();
  for (const dp of dataPoints) {
    const list = grouped.get(dp.name) ?? [];
    list.push(dp);
    grouped.set(dp.name, list);
  }

  for (const [name, points] of grouped.entries()) {
    const first = points[0];
    if (first) {
      lines.push(`# HELP ${name} ${first.help}`);
      lines.push(`# TYPE ${name} ${first.type}`);
    }

    for (const dp of points) {
      if (dp.type === 'histogram' && dp.buckets) {
        for (const bucket of dp.buckets) {
          const bucketLabels = { ...dp.labels, le: String(bucket.le) };
          lines.push(`${dp.name}_bucket${formatPrometheusLabels(bucketLabels)} ${bucket.count}`);
        }
        const infLabels = { ...dp.labels, le: '+Inf' };
        lines.push(`${dp.name}_bucket${formatPrometheusLabels(infLabels)} ${dp.count ?? 0}`);
        lines.push(`${dp.name}_sum${formatPrometheusLabels(dp.labels)} ${dp.sum ?? 0}`);
        lines.push(`${dp.name}_count${formatPrometheusLabels(dp.labels)} ${dp.count ?? 0}`);
      } else {
        lines.push(`${dp.name}${formatPrometheusLabels(dp.labels)} ${dp.value}`);
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

/**
 * @purpose Coordinator exposing scrape() function for /metrics HTTP endpoints.
 * @rationale Clean wrapper for mounting on Hono or Node/Bun HTTP handlers.
 * @invariants Delegates to MetricsRegistry.collect() and serializeToPrometheusText().
 */
export class PrometheusRegistry {
  private readonly registry: MetricsRegistry;

  public constructor(registry: MetricsRegistry) {
    this.registry = registry;
  }

  /**
   * @purpose Produces Prometheus text exposition output.
   * @returns Formatted Prometheus text string ready to send with Content-Type text/plain; version=0.0.4.
   */
  public scrape(): string {
    const points = this.registry.collect();
    return serializeToPrometheusText(points);
  }
}
