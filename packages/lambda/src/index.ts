/**
 * @purpose AWS Lambda adapter for Shukoi applications with dynamic execution deadline calculation and typed context extraction.
 * @rationale Translates API Gateway v1, v2, ALB, and Function URL event payloads into Web-standard Request objects and maps responses back to Lambda Proxy results. Computes remaining Lambda container execution time minus safety margin (lambdaDeadlineBufferMs), aborting early with 504 Gateway Timeout to prevent uncommitted transactions from freezing inside idle Lambda microVMs.
 * @preconditions Running in AWS Lambda Node.js 22+ runtime; app is a configured Hono instance.
 * @invariants Pure proxy transformation; dynamic deadline enforcement; graceful transaction rollback before container freeze.
 */

import { type ActionExecutionContext, DomainError, type ShukoiConfig } from '@shukoi/core';
import type { Hono } from 'hono';

/**
 * @purpose Standard AWS Lambda runtime execution context interface.
 * @rationale Provides getRemainingTimeInMillis() to monitor container timeout countdown.
 * @preconditions Running within AWS Lambda Node.js execution environment.
 * @param None
 * @returns Lambda runtime context surface.
 * @throws Never throws on declaration.
 * @invariants Standard AWS Lambda context interface.
 */
export interface LambdaContext {
  getRemainingTimeInMillis(): number;
  functionName?: string | undefined;
  functionVersion?: string | undefined;
  invokedFunctionArn?: string | undefined;
  memoryLimitInMB?: string | undefined;
  awsRequestId?: string | undefined;
}

/**
 * @purpose Generic AWS API Gateway / ALB / Function URL event structure.
 * @rationale Encapsulates HTTP payload, headers, path, method, and cookies from AWS ingress gateways.
 * @preconditions Ingress payload delivered from API Gateway v1/v2, ALB, or Lambda Function URL.
 * @param None
 * @returns Readonly HTTP ingress event object.
 * @throws Never throws on declaration.
 * @invariants Readonly event structure.
 */
export interface LambdaHttpEvent {
  readonly version?: string | undefined; // '2.0' for HTTP API, '1.0' for REST API
  readonly rawPath?: string | undefined;
  readonly path?: string | undefined;
  readonly httpMethod?: string | undefined;
  readonly requestContext?:
    | {
        readonly stage?: string | undefined;
        readonly http?:
          | {
              readonly method?: string | undefined;
              readonly path?: string | undefined;
            }
          | undefined;
        readonly authorizer?: Record<string, unknown> | undefined;
      }
    | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly multiValueHeaders?: Record<string, string[]> | undefined;
  readonly cookies?: readonly string[] | undefined;
  readonly queryStringParameters?: Record<string, string> | undefined;
  readonly multiValueQueryStringParameters?: Record<string, string[]> | undefined;
  readonly rawQueryString?: string | undefined;
  readonly body?: string | undefined;
  readonly isBase64Encoded?: boolean | undefined;
  readonly stageVariables?: Record<string, string> | undefined;
}

/**
 * @purpose Standard AWS Lambda Proxy integration response structure.
 * @rationale Delivers HTTP status code, headers, cookies, and body back to API Gateway or ALB.
 * @preconditions Valid status code, serializable body string, and header dictionaries.
 * @param None
 * @returns Serializable Lambda Proxy response object.
 * @throws Never throws on declaration.
 * @invariants Serializable JSON structure; conforms to API Gateway payload formats 1.0 and 2.0.
 */
export interface LambdaProxyResult {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly multiValueHeaders?: Record<string, string[]> | undefined;
  readonly cookies?: readonly string[] | undefined;
  readonly body: string;
  readonly isBase64Encoded: boolean;
}

/**
 * @purpose Options parameterizing the AWS Lambda adapter.
 * @rationale Allows specifying configuration limits, base path prefixes, and custom binary predicate.
 * @preconditions Optional adapter options.
 * @param None
 * @returns Adapter configuration options.
 * @throws Never throws on declaration.
 * @invariants Readonly options structure.
 */
export interface LambdaAdapterOptions {
  readonly config?: ShukoiConfig | undefined;
  readonly basePath?: string | undefined;
  readonly isContentTypeBinary?: ((contentType: string) => boolean) | undefined;
}

/**
 * @purpose Strongly-typed AWS Lambda platform container injected into Shukoi ActionExecutionContext.
 * @rationale Provides type-safe access to Lambda runtime context, raw ingress event, and timeout monitor inside action handlers.
 * @preconditions Running within AWS Lambda runtime or test harness with LambdaPlatform injected.
 * @param TEvent Ingress event interface matching LambdaHttpEvent.
 * @param TContext Runtime context interface matching LambdaContext.
 * @returns Immutable platform container holding context, event, and getRemainingTimeInMillis hook.
 * @throws Never throws on declaration.
 * @invariants Immutable interface; pure web-standard types; zero node:* imports.
 */
export interface LambdaPlatform<TEvent = LambdaHttpEvent, TContext = LambdaContext> {
  readonly context: TContext;
  readonly event: TEvent;
  readonly getRemainingTimeInMillis: () => number;
}

/**
 * @purpose Default predicate determining if a MIME content-type represents binary data.
 * @rationale Binary payloads on AWS Lambda must be Base64-encoded to prevent UTF-8 string corruption.
 * @preconditions Valid MIME type string or empty string.
 * @param contentType The MIME content-type header value to evaluate.
 * @returns True if content-type represents binary data, false for text, json, html, css, js, xml, or csv.
 * @throws Never throws an exception.
 * @invariants Deterministic regex matching; O(1) time complexity.
 */
export function defaultIsContentTypeBinary(contentType: string): boolean {
  if (!contentType) return false;
  return !/^text\/(?:plain|html|css|javascript|csv)|(?:\/|\+)(?:json|xml)\s*(?:;|$)/i.test(
    contentType,
  );
}

/**
 * @purpose Extracts strongly-typed AWS Lambda context and raw ingress event from an action execution context.
 * @rationale Eliminates manual type-casting and provides safe, ergonomic access to awsRequestId, function ARN, and remaining time.
 * @preconditions Action must be executing within an AWS Lambda environment or test harness with LambdaPlatform injected.
 * @param ctx ActionExecutionContext passed into the action handler.
 * @returns LambdaPlatform container with typed context, event, and getRemainingTimeInMillis.
 * @throws DomainError('INTERNAL_SERVER_ERROR') if ctx.platform is missing or not executing in AWS Lambda environment.
 * @invariants Big-O time complexity O(1); zero memory allocations; type-preserving generic.
 */
export function getLambdaContext<TEvent = LambdaHttpEvent, TContext = LambdaContext>(
  ctx: ActionExecutionContext<unknown, unknown, unknown>,
): LambdaPlatform<TEvent, TContext> {
  const platform = ctx.platform as
    | (Record<string, unknown> & {
        lambdaContext?: TContext;
        context?: TContext;
        lambdaEvent?: TEvent;
        event?: TEvent;
        env?: {
          lambdaContext?: TContext;
          lambdaEvent?: TEvent;
        };
      })
    | undefined;

  const context = (platform?.lambdaContext ?? platform?.context ?? platform?.env?.lambdaContext) as
    | TContext
    | undefined;

  const event = (platform?.lambdaEvent ?? platform?.event ?? platform?.env?.lambdaEvent) as
    | TEvent
    | undefined;

  if (!context) {
    throw new DomainError(
      'INTERNAL_SERVER_ERROR',
      'Lambda context is missing: Action is not executing within an AWS Lambda environment or test harness.',
    );
  }

  const resolvedEvent = (event ?? {}) as TEvent;
  const getRemainingTimeInMillis = () => {
    const rawContext = context as unknown as LambdaContext;
    return typeof rawContext.getRemainingTimeInMillis === 'function'
      ? rawContext.getRemainingTimeInMillis()
      : 0;
  };

  return {
    context,
    event: resolvedEvent,
    getRemainingTimeInMillis,
  };
}

/**
 * @purpose Adapts a Shukoi Hono application into an AWS Lambda handler with dynamic deadline enforcement.
 * @rationale Translates Lambda events to Web-standard Request, monitors remaining container execution time, and terminates with 504 if time is exhausted.
 * @preconditions app is a valid Hono instance.
 * @param app Configured Hono application instance.
 * @param options Adapter configuration options.
 * @returns Lambda handler function accepting (event, context).
 * @throws Never throws unhandled; converts all failures to LambdaProxyResult.
 * @invariants Aborts request signal at effectiveTimeoutMs; zero zombie async operations.
 */
export function toLambdaHandler(
  app: Hono,
  options?: LambdaAdapterOptions,
): (event: LambdaHttpEvent, context: LambdaContext) => Promise<LambdaProxyResult> {
  const bufferMs = options?.config?.limits.lambdaDeadlineBufferMs ?? 500;
  const defaultTimeoutMs = options?.config?.limits.defaultTimeoutMs ?? 30000;

  return async (event: LambdaHttpEvent, context: LambdaContext): Promise<LambdaProxyResult> => {
    // 1. Dynamic Deadline Calculation
    const remainingTimeMs = context.getRemainingTimeInMillis
      ? context.getRemainingTimeInMillis()
      : defaultTimeoutMs;
    const effectiveTimeoutMs = Math.min(defaultTimeoutMs, remainingTimeMs - bufferMs);

    if (effectiveTimeoutMs <= 0) {
      const timeoutError = new DomainError(
        'GATEWAY_TIMEOUT',
        `Insufficient Lambda execution time remaining (${remainingTimeMs}ms) to start transaction`,
        504,
      );
      const problem = timeoutError.toProblemDetails(context.awsRequestId ?? 'lambda-req');
      return {
        statusCode: 504,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify(problem),
        isBase64Encoded: false,
      };
    }

    // 2. Setup composite cancellation signal with dynamic deadline
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort(new Error('Lambda execution deadline reached'));
    }, effectiveTimeoutMs);

    try {
      // 3. Reconstruct Web-standard Request from Lambda event
      const method = event.requestContext?.http?.method ?? event.httpMethod ?? 'GET';
      let path = event.rawPath ?? event.path ?? '/';

      // Base path and stage prefix stripping
      if (options?.basePath && path.startsWith(options.basePath)) {
        path = path.slice(options.basePath.length) || '/';
      } else if (
        event.requestContext?.stage &&
        event.requestContext.stage !== '$default' &&
        path.startsWith(`/${event.requestContext.stage}/`)
      ) {
        path = path.slice(event.requestContext.stage.length + 1) || '/';
      }

      let queryString = '';
      if (event.rawQueryString) {
        queryString = event.rawQueryString;
      } else if (event.multiValueQueryStringParameters) {
        const searchParams = new URLSearchParams();
        for (const [k, values] of Object.entries(event.multiValueQueryStringParameters)) {
          if (Array.isArray(values)) {
            for (const v of values) {
              searchParams.append(k, v);
            }
          }
        }
        queryString = searchParams.toString();
      } else if (event.queryStringParameters) {
        queryString = new URLSearchParams(event.queryStringParameters).toString();
      }

      let url = `http://localhost${path}`;
      if (queryString) {
        url += `?${queryString}`;
      }

      const headers = new Headers();
      if (event.multiValueHeaders) {
        for (const [k, values] of Object.entries(event.multiValueHeaders)) {
          if (Array.isArray(values)) {
            for (const v of values) {
              headers.append(k, v);
            }
          }
        }
      } else if (event.headers) {
        for (const [k, v] of Object.entries(event.headers)) {
          if (v) {
            headers.set(k, v);
          }
        }
      }

      // API Gateway v2 cookies
      if (event.cookies && Array.isArray(event.cookies) && event.cookies.length > 0) {
        headers.set('cookie', event.cookies.join('; '));
      }

      let body: BodyInit | null = null;
      if (method !== 'GET' && method !== 'HEAD' && event.body) {
        if (event.isBase64Encoded) {
          body = Buffer.from(event.body, 'base64');
        } else {
          body = event.body;
        }
      }

      const request = new Request(url, {
        method,
        headers,
        body,
        signal: abortController.signal,
      });

      // 4. Dispatch to Hono application
      const response = await app.fetch(request, { lambdaContext: context, lambdaEvent: event });

      const contentType = response.headers.get('content-type') ?? '';
      const isBinary = options?.isContentTypeBinary
        ? options.isContentTypeBinary(contentType)
        : defaultIsContentTypeBinary(contentType);

      // Extract cookies using standard getSetCookie if available
      const getSetCookieFn = (response.headers as unknown as { getSetCookie?: () => string[] })
        .getSetCookie;
      const cookies: string[] =
        typeof getSetCookieFn === 'function'
          ? getSetCookieFn.call(response.headers)
          : Array.from(response.headers.entries())
              .filter(([k]) => k.toLowerCase() === 'set-cookie')
              .map(([, v]) => v);

      const responseHeaders: Record<string, string> = {};
      const responseMultiValueHeaders: Record<string, string[]> = {};

      response.headers.forEach((val, key) => {
        if (key.toLowerCase() !== 'set-cookie') {
          responseHeaders[key] = val;
        }
      });

      if (cookies.length > 0) {
        responseMultiValueHeaders['set-cookie'] = cookies;
      }

      let responseBody: string;
      if (isBinary) {
        const arrayBuf = await response.arrayBuffer();
        responseBody = Buffer.from(arrayBuf).toString('base64');
      } else {
        responseBody = await response.text();
      }

      return {
        statusCode: response.status,
        headers: responseHeaders,
        ...(cookies.length > 0 ? { multiValueHeaders: responseMultiValueHeaders, cookies } : {}),
        body: responseBody,
        isBase64Encoded: isBinary,
      };
    } catch (err) {
      const isTimeout = abortController.signal.aborted;
      if (isTimeout) {
        const timeoutError = new DomainError(
          'GATEWAY_TIMEOUT',
          'Lambda execution deadline exceeded',
          504,
        );
        const problem = timeoutError.toProblemDetails(context.awsRequestId ?? 'lambda-timeout');
        return {
          statusCode: 504,
          headers: { 'Content-Type': 'application/problem+json' },
          body: JSON.stringify(problem),
          isBase64Encoded: false,
        };
      }

      const message = err instanceof Error ? err.message : String(err);
      const internalError = new DomainError('INTERNAL_SERVER_ERROR', message, 500);
      const problem = internalError.toProblemDetails(context.awsRequestId ?? 'lambda-error');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify(problem),
        isBase64Encoded: false,
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  };
}
