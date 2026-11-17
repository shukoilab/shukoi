/**
 * @purpose OpenTelemetry Distributed Tracing and Metrics Plugin for Shukoi.
 * @rationale Integrates W3C TraceContext extraction, span lifecycle management, and Prometheus metrics via ShukoiPlugin.
 * @preconditions OpenTelemetryPluginConfig.
 * @invariants Pure Web standards; Big-O O(1) plugin lifecycle execution overhead; zero memory leaks.
 */

import type { ActionExecutionContext, CompiledAction, ShukoiPlugin } from '@shukoi/core';
import type { TSchema } from '@sinclair/typebox';
import { MetricsRegistry } from './metrics.js';
import { Tracer } from './tracer.js';
import type { OpenTelemetryPluginConfig } from './types.js';

export * from './edge.js';
export * from './metrics.js';
export * from './prometheus.js';
export * from './testing.js';
export * from './tracer.js';
export * from './types.js';

/**
 * @purpose Extended plugin interface providing direct access to the underlying Tracer and MetricsRegistry.
 * @rationale Enables application code or server health probes to scrape metrics or trace custom operations.
 * @invariants Implements ShukoiPlugin contract.
 */
export interface OpenTelemetryPluginInstance extends ShukoiPlugin {
  readonly tracer: Tracer;
  readonly metrics: MetricsRegistry;
  flush(): Promise<void>;
}

/**
 * @purpose Factory creating an OpenTelemetry ShukoiPlugin instance.
 * @rationale Automates span creation, W3C correlation extraction, duration tracking, and error recording.
 * @param config Plugin configuration options.
 * @returns Fully configured OpenTelemetryPluginInstance.
 * @throws Never throws during plugin factory invocation.
 * @invariants Non-blocking execution; bounded ring buffer; safe failure handling.
 */
export function createOpenTelemetryPlugin(
  config: OpenTelemetryPluginConfig,
): OpenTelemetryPluginInstance {
  const tracer = new Tracer(config);
  const metrics = new MetricsRegistry();

  const activeSpans = new WeakMap<object, ReturnType<typeof tracer.startSpan>>();

  const callsCounter = metrics.getOrCreateCounter(
    'shukoi_action_calls_total',
    'Total count of Shukoi action invocations',
  );

  const durationHistogram = metrics.getOrCreateHistogram(
    'shukoi_action_duration_ms',
    'Duration of Shukoi action executions in milliseconds',
  );

  const activeGauge = metrics.getOrCreateUpDownCounter(
    'shukoi_action_active_requests',
    'Current number of concurrently executing action requests',
  );

  const plugin: OpenTelemetryPluginInstance = {
    name: 'opentelemetry',
    tracer,
    metrics,

    async flush(): Promise<void> {
      await tracer.flush();
    },

    onActionStart(
      action: CompiledAction<TSchema, TSchema, unknown, unknown, unknown>,
      ctx: ActionExecutionContext<unknown, unknown, unknown>,
    ): void {
      const parentHeader = ctx.headers['traceparent'] ?? ctx.headers['Traceparent'];
      const span = tracer.startSpan(`shukoi.action.${action.name}`, parentHeader);

      span.setAttribute('shukoi.action.name', action.name);
      span.setAttribute('shukoi.transport', ctx.transport);
      span.setAttribute('shukoi.request_id', ctx.requestId);

      if (ctx.idempotencyKey) {
        span.setAttribute('shukoi.idempotency_key', ctx.idempotencyKey);
      }

      if (ctx.user && typeof ctx.user === 'object' && 'id' in ctx.user) {
        span.setAttribute('shukoi.user.id', String((ctx.user as { id: unknown }).id));
      }

      activeGauge.add(1, { action: action.name });
      activeSpans.set(ctx, span);
    },

    onActionSuccess(
      action: CompiledAction<TSchema, TSchema, unknown, unknown, unknown>,
      ctx: ActionExecutionContext<unknown, unknown, unknown>,
    ): void {
      const span = activeSpans.get(ctx);
      if (span) {
        span.setStatus('OK');
        span.end();
        activeSpans.delete(ctx);

        const duration = Math.max(0, Date.now() - span.startTimeMs);
        callsCounter.inc(1, { action: action.name, status: 'success' });
        durationHistogram.record(duration, {
          action: action.name,
          status: 'success',
          transport: ctx.transport,
        });
      }
    },

    onActionError(
      action: CompiledAction<TSchema, TSchema, unknown, unknown, unknown>,
      ctx: ActionExecutionContext<unknown, unknown, unknown>,
      error: Error,
    ): void {
      const span = activeSpans.get(ctx);
      const errorCode =
        'code' in error && typeof (error as { code: unknown }).code === 'string'
          ? String((error as { code: unknown }).code)
          : 'INTERNAL_ERROR';

      if (span) {
        span.setStatus('ERROR', error.message);
        span.setAttribute('shukoi.error.code', errorCode);
        span.setAttribute('shukoi.error.message', error.message);
        span.end();
        activeSpans.delete(ctx);

        const duration = Math.max(0, Date.now() - span.startTimeMs);
        callsCounter.inc(1, {
          action: action.name,
          status: 'error',
          error_code: errorCode,
        });
        durationHistogram.record(duration, {
          action: action.name,
          status: 'error',
          transport: ctx.transport,
        });
      }
    },

    onActionTeardown(
      action: CompiledAction<TSchema, TSchema, unknown, unknown, unknown>,
      ctx: ActionExecutionContext<unknown, unknown, unknown>,
    ): void {
      // Ensure in-flight gauge is always decremented upon teardown
      activeGauge.add(-1, { action: action.name });
      // If error or success was not called, terminate hanging span
      const remainingSpan = activeSpans.get(ctx);
      if (remainingSpan) {
        remainingSpan.setStatus('ERROR', 'Action aborted before completion');
        remainingSpan.end();
        activeSpans.delete(ctx);
      }
    },
  };

  return plugin;
}
