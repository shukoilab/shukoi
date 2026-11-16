/**
 * @purpose Hono REST router integration, CORS middleware, OpenAPI mounting, and RFC 9457 error serialization.
 * @rationale Exposes declarative actions over HTTP REST with deterministic parameter merging, stream-bounded body parsing, and standard error handling.
 * @preconditions actions is a list of CompiledAction instances; config is a ShukoiConfig.
 * @invariants Pure Web-Standard router; zero node:* dependencies; strict parameter merge priority (Query < Body < Path).
 */

import {
  type CompiledAction,
  DomainError,
  executeAction,
  type IdempotencyStore,
  type ShukoiConfig,
  type SingleFlightJwksClient,
} from '@shukoi/core';
import { type Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { generateOpenApiSpec } from './openapi.js';
import { readBoundedJsonStream } from './stream.js';

/**
 * @purpose Options for configuring the REST API router.
 * @rationale Permits injecting dependency services, custom OpenAPI routes, and persistence stores into HTTP endpoints.
 * @invariants Readonly options object.
 */
export interface RestRouterOptions<TServices = unknown> {
  readonly services?: TServices;
  readonly idempotencyStore?: IdempotencyStore;
  readonly jwksClient?: SingleFlightJwksClient;
  readonly staticApiKeys?: Readonly<Record<string, unknown>>;
  readonly openApiPath?: string;
}

/**
 * @purpose Coerces string-based query or path parameter values into primitives based on value appearance.
 * @rationale HTTP query strings and path segments are inherently text strings; numeric and boolean schema fields require safe coercion without wiping leading zeros on string identifiers.
 * @param raw String value from query parameter or path segment.
 * @returns Coerced number, boolean, or original string.
 * @throws Never throws.
 * @invariants Pure conversion function; Big-O O(1).
 */
export function coercePrimitiveParam(raw: string): unknown {
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  // Leading zeros on numeric strings (e.g. "01234", "007"): preserve as string
  if (/^0\d+$/.test(raw)) {
    return raw;
  }
  // Clean integer: 0 or non-zero leading integer
  if (/^-?(0|[1-9]\d*)$/.test(raw)) {
    const num = Number.parseInt(raw, 10);
    if (!Number.isNaN(num) && Number.isSafeInteger(num)) {
      return num;
    }
  }
  // Decimal float
  if (/^-?(0|[1-9]\d*)\.\d+$/.test(raw)) {
    const num = Number.parseFloat(raw);
    if (!Number.isNaN(num)) {
      return num;
    }
  }
  return raw;
}

/**
 * @purpose Extracts all incoming request headers into a plain string record.
 * @rationale Flattens standard Headers interface into a normalized record for auth and correlation verification.
 * @param req Web-standard Request instance.
 * @returns Plain record of header key-value pairs.
 * @throws Never throws.
 * @invariants O(h) where h is header count.
 */
export function extractHeaders(req: Request): Record<string, string> {
  const result: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

/**
 * @purpose Creates a fully configured Hono REST router exposing declarative actions as HTTP endpoints.
 * @rationale Implements Protocol Module A of Shukoi, generating OpenAPI documentation, enforcing CORS, and executing actions with parameter merging.
 * @preconditions actions array with http metadata; valid config.
 * @param actions Array of CompiledAction instances.
 * @param config ShukoiConfig instance.
 * @param options Optional router options for services and storage.
 * @returns Configured Hono application instance.
 * @throws Never throws during initialization.
 * @invariants Zero node:* imports; 100% web-standard compatible across Bun, Node, and Cloudflare Workers.
 */
export function createRestRouter<TServices = unknown>(
  actions: readonly CompiledAction[],
  config: ShukoiConfig,
  options?: RestRouterOptions<TServices>,
): Hono {
  const app = new Hono();
  const openApiPath = options?.openApiPath ?? '/openapi.json';

  // 1. CORS & Preflight Middleware
  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const isAllowedOrigin =
      config.security.allowedOrigins.includes('*') ||
      (typeof origin === 'string' && config.security.allowedOrigins.includes(origin));

    if (isAllowedOrigin && origin) {
      c.res.headers.set('Access-Control-Allow-Origin', origin);
      c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      c.res.headers.set(
        'Access-Control-Allow-Headers',
        `Content-Type, Authorization, ${config.security.apiKeyHeaderName}, ${config.observability.correlationIdHeader}, Idempotency-Key`,
      );
      c.res.headers.set('Access-Control-Max-Age', '86400');
    }

    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }

    await next();
  });

  // 2. RFC 9457 Problem Details Error Handler
  app.onError((err: Error, c: Context) => {
    const correlationHeader = config.observability.correlationIdHeader.toLowerCase();
    const requestId =
      c.req.header(correlationHeader) ??
      c.req.header(config.observability.correlationIdHeader) ??
      crypto.randomUUID();

    if (err instanceof DomainError) {
      const problem = err.toProblemDetails(requestId, c.req.path);
      return c.json(problem, err.statusCode as ContentfulStatusCode, {
        'Content-Type': 'application/problem+json',
      });
    }

    const internalError = new DomainError(
      'INTERNAL_SERVER_ERROR',
      'An unexpected internal error occurred',
      500,
    );
    const problem = internalError.toProblemDetails(requestId, c.req.path);
    return c.json(problem, 500, {
      'Content-Type': 'application/problem+json',
    });
  });

  // 3. RFC 9457 Route Not Found Handler (404)
  app.notFound((c: Context) => {
    const correlationHeader = config.observability.correlationIdHeader.toLowerCase();
    const requestId =
      c.req.header(correlationHeader) ??
      c.req.header(config.observability.correlationIdHeader) ??
      crypto.randomUUID();

    const notFoundError = new DomainError(
      'NOT_FOUND',
      `Route "${c.req.method} ${c.req.path}" not found`,
      404,
    );
    const problem = notFoundError.toProblemDetails(requestId, c.req.path);
    return c.json(problem, 404, {
      'Content-Type': 'application/problem+json',
    });
  });

  // 4. OpenAPI 3.1.0 Specification Route
  const openApiSpec = generateOpenApiSpec(actions, config);
  app.get(openApiPath, (c) => {
    return c.json(openApiSpec, 200);
  });

  // 5. Mount Actions as REST Routes
  for (const action of actions) {
    if (!action.http) {
      continue;
    }

    const { method, path, successStatus } = action.http;

    app.on(method, path, async (c) => {
      // Step A: Parse query parameters (supporting both single and multi-value arrays)
      const rawQueries = typeof c.req.queries === 'function' ? c.req.queries() : undefined;
      const rawQuery = c.req.query();
      const queryParams: Record<string, unknown> = {};

      if (rawQueries) {
        for (const [k, vList] of Object.entries(rawQueries)) {
          const cleanKey = k.endsWith('[]') ? k.slice(0, -2) : k;
          if (Array.isArray(vList) && vList.length > 1) {
            queryParams[cleanKey] = vList.map((item) => coercePrimitiveParam(item));
          } else if (Array.isArray(vList) && vList.length === 1 && vList[0] !== undefined) {
            queryParams[cleanKey] = coercePrimitiveParam(vList[0]);
          }
        }
      } else {
        for (const [k, v] of Object.entries(rawQuery)) {
          const cleanKey = k.endsWith('[]') ? k.slice(0, -2) : k;
          queryParams[cleanKey] = coercePrimitiveParam(v);
        }
      }

      // Step B: Parse request body (stream bounded)
      let bodyData: unknown = {};
      if (method !== 'GET' && method !== 'DELETE') {
        bodyData = await readBoundedJsonStream(c.req.raw.body, config.limits.maxBodyBytes);
      }

      // Step C: Parse path parameters and coerce primitives
      const rawPathParams = c.req.param() as Record<string, string>;
      const pathParams: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawPathParams)) {
        pathParams[k] = coercePrimitiveParam(String(v));
      }

      // Step D: Merge in strict priority: Query Params < JSON Body < Path Params
      // Path parameters always win and cannot be overwritten by query or body
      const mergedInput: Record<string, unknown> = {
        ...queryParams,
        ...(bodyData !== null && typeof bodyData === 'object'
          ? (bodyData as Record<string, unknown>)
          : {}),
        ...pathParams,
      };

      const headers = extractHeaders(c.req.raw);

      let executionCtx: { waitUntil?: (p: Promise<unknown>) => void } | undefined;
      try {
        executionCtx = (c as { executionCtx?: { waitUntil?: (p: Promise<unknown>) => void } })
          .executionCtx;
      } catch {
        // Not executing in an environment with ExecutionContext
      }

      const platform = {
        env: c.env,
        executionCtx,
        waitUntil: (promise: Promise<unknown>) => {
          if (executionCtx && typeof executionCtx.waitUntil === 'function') {
            executionCtx.waitUntil(promise);
          } else {
            promise.catch(() => {});
          }
        },
        ...(typeof c.env === 'object' && c.env !== null ? c.env : {}),
      };

      // Detect if this execution is an idempotent replay
      const idempotencyHeaderName = (
        action.http?.idempotencyHeaderName ?? 'idempotency-key'
      ).toLowerCase();
      const idempotencyKey = headers[idempotencyHeaderName] ?? headers['idempotency-key'];
      let isReplay = false;
      if (action.http?.requireIdempotencyKey && idempotencyKey && options?.idempotencyStore?.get) {
        const existing = await options.idempotencyStore.get(action.name, idempotencyKey);
        if (existing && existing.status === 'COMPLETED') {
          isReplay = true;
        }
      }

      const result = await executeAction(action, mergedInput, {
        config,
        transport: 'rest',
        headers,
        signal: c.req.raw.signal,
        platform,
        services: options?.services,
        idempotencyStore: options?.idempotencyStore,
        jwksClient: options?.jwksClient,
        staticApiKeys: options?.staticApiKeys,
      });

      if (isReplay) {
        c.header('Idempotent-Replayed', 'true');
      }

      const statusCode = successStatus ?? 200;
      if (statusCode === 204) {
        return c.body(null, 204);
      }

      const customContentType = action.http?.customContentType;
      if (customContentType && customContentType !== 'application/json') {
        return c.body(result as string | ArrayBuffer, statusCode as ContentfulStatusCode, {
          'Content-Type': customContentType,
        });
      }

      return c.json(result, statusCode as ContentfulStatusCode);
    });
  }

  return app;
}
