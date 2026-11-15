/**
 * @purpose Cloudflare Workers runtime adapter for Shukoi applications.
 * @rationale Adapts standard Hono application to Cloudflare V8 Workers isolates with executionCtx.waitUntil integration.
 * @preconditions Running in Cloudflare Workers environment; app is a configured Hono instance.
 * @invariants Pure Web-Standard implementation; zero node:* imports.
 */

import type { ExecutionContext, Hono } from 'hono';

/**
 * @purpose Cloudflare Workers ExecutionContext interface.
 * @rationale Provides waitUntil and passThroughOnException hooks native to Cloudflare Workers runtime.
 * @invariants Standard Cloudflare Workers platform API.
 */
export interface CloudflareExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  props?: Record<string, unknown> | undefined;
}

/**
 * @purpose Cloudflare Worker export interface matching standard Workers module syntax.
 * @rationale Exports default object with fetch handler.
 * @invariants Immutable interface contract.
 */
export interface CloudflareWorkerExport {
  fetch(
    request: Request,
    env: Record<string, unknown>,
    executionCtx: CloudflareExecutionContext,
  ): Promise<Response>;
}

/**
 * @purpose Wraps a Shukoi Hono application into a Cloudflare Workers fetch handler module.
 * @rationale Passes Cloudflare environment bindings (D1, KV, R2, Queues) and connects executionCtx.waitUntil for post-response tasks.
 * @preconditions app is a valid Hono instance.
 * @param app Configured Hono application instance.
 * @returns CloudflareWorkerExport object with fetch method.
 * @throws Never throws during adaptation.
 * @invariants Big-O time complexity O(1); zero memory leaks; pure web standard.
 */
export function toCloudflareWorker(app: Hono): CloudflareWorkerExport {
  return {
    async fetch(
      request: Request,
      env: Record<string, unknown>,
      executionCtx: CloudflareExecutionContext,
    ): Promise<Response> {
      // Execute the request with Cloudflare env injected
      return app.fetch(request, env, executionCtx as unknown as ExecutionContext);
    },
  };
}
