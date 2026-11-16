/**
 * @purpose Cloudflare Workers runtime adapter for Shukoi applications.
 * @rationale Adapts standard Hono application to Cloudflare V8 Workers isolates with executionCtx.waitUntil integration.
 * @preconditions Running in Cloudflare Workers environment; app is a configured Hono instance.
 * @invariants Pure Web-Standard implementation; zero node:* imports.
 */

import { type ActionExecutionContext, DomainError } from '@shukoi/core';
import type { ExecutionContext, Hono } from 'hono';

/**
 * @purpose Cloudflare Workers ExecutionContext interface.
 * @rationale Provides waitUntil and passThroughOnException hooks native to Cloudflare Workers runtime.
 * @preconditions Cloudflare Workers runtime environment.
 * @param None
 * @returns Cloudflare ExecutionContext API surface.
 * @throws Never throws on instantiation.
 * @invariants Standard Cloudflare Workers platform API.
 */
export interface CloudflareExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  props?: Record<string, unknown> | undefined;
}

/**
 * @purpose Strongly-typed Cloudflare platform container injected into Shukoi ActionExecutionContext.
 * @rationale Provides type-safe access to Cloudflare bindings (D1, KV, R2, Queues) and lifecycle background task scheduling.
 * @preconditions Running within Cloudflare Workers isolate or test harness with CloudflarePlatform injected.
 * @param TEnv Interface of bound Cloudflare resources.
 * @returns Immutable platform container holding env and waitUntil hook.
 * @throws Never throws on declaration.
 * @invariants Immutable interface; pure web-standard types; zero node:* imports.
 */
export interface CloudflarePlatform<TEnv = Record<string, unknown>> {
  readonly env: TEnv;
  readonly executionCtx?: CloudflareExecutionContext | undefined;
  readonly waitUntil: (promise: Promise<unknown>) => void;
}

/**
 * @purpose Cloudflare Worker export interface matching standard Workers module syntax.
 * @rationale Exports default object with fetch handler.
 * @preconditions Conforms to Cloudflare Workers ES Module export contract.
 * @param request Standard Web Request.
 * @returns Promise resolving to Web Response.
 * @throws Unhandled exceptions from fetch handler.
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
 * @purpose Extracts strongly-typed Cloudflare Workers bindings and lifecycle helpers from an action execution context.
 * @rationale Eliminates manual type-casting and provides safe, ergonomic access to D1, KV, R2, and waitUntil hooks.
 * @preconditions Action must be executing within a Cloudflare Workers isolate or test harness with CloudflarePlatform injected.
 * @param ctx ActionExecutionContext passed into the action handler.
 * @returns CloudflarePlatform container with typed env and waitUntil function.
 * @throws DomainError('INTERNAL_SERVER_ERROR') if ctx.platform is missing or not executing in Cloudflare environment.
 * @invariants Big-O time complexity O(1); zero memory allocations; type-preserving generic.
 */
export function getCloudflareContext<TEnv = Record<string, unknown>>(
  ctx: ActionExecutionContext<unknown, unknown, unknown>,
): CloudflarePlatform<TEnv> {
  const platform = ctx.platform as (CloudflarePlatform<TEnv> & TEnv) | undefined;
  if (!platform) {
    throw new DomainError(
      'INTERNAL_SERVER_ERROR',
      'Cloudflare context is missing: Action is not executing within a Cloudflare Workers isolate or test harness.',
    );
  }

  // If platform.env is defined, use it; otherwise fallback to platform itself if bindings were attached directly
  const env = (platform.env ?? platform) as TEnv;
  const executionCtx = platform.executionCtx;
  const waitUntil =
    platform.waitUntil ??
    ((promise: Promise<unknown>) => {
      if (executionCtx?.waitUntil) {
        executionCtx.waitUntil(promise);
      } else {
        promise.catch(() => {});
      }
    });

  return {
    env,
    executionCtx,
    waitUntil,
  };
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
