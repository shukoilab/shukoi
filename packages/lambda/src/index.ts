/**
 * @purpose AWS Lambda adapter for Shukoi applications with dynamic execution deadline calculation.
 * @rationale Computes remaining Lambda container execution time minus safety margin (lambdaDeadlineBufferMs), aborting early with 504 Gateway Timeout to prevent uncommitted transactions from freezing inside idle Lambda microVMs.
 * @preconditions Running in AWS Lambda Node.js 22+ runtime; app is a configured Hono instance.
 * @invariants Pure proxy transformation; dynamic deadline enforcement; graceful transaction rollback before container freeze.
 */

import { DomainError, type ShukoiConfig } from '@shukoi/core';
import type { Hono } from 'hono';

/**
 * @purpose Standard AWS Lambda runtime execution context interface.
 * @rationale Provides getRemainingTimeInMillis() to monitor container timeout countdown.
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
 * @rationale Encapsulates HTTP payload, headers, path, and method from AWS ingress gateways.
 * @invariants Readonly event structure.
 */
export interface LambdaHttpEvent {
  readonly version?: string | undefined; // '2.0' for HTTP API, '1.0' for REST API
  readonly rawPath?: string | undefined;
  readonly path?: string | undefined;
  readonly httpMethod?: string | undefined;
  readonly requestContext?:
    | {
        readonly http?:
          | {
              readonly method?: string | undefined;
              readonly path?: string | undefined;
            }
          | undefined;
      }
    | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly queryStringParameters?: Record<string, string> | undefined;
  readonly rawQueryString?: string | undefined;
  readonly body?: string | undefined;
  readonly isBase64Encoded?: boolean | undefined;
}

/**
 * @purpose Standard AWS Lambda Proxy integration response structure.
 * @rationale Delivers HTTP status code, headers, and body back to API Gateway or ALB.
 * @invariants Serializable JSON structure.
 */
export interface LambdaProxyResult {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly isBase64Encoded: boolean;
}

/**
 * @purpose Options parameterizing the AWS Lambda adapter.
 * @rationale Allows specifying configuration limits and base path prefixes.
 * @invariants Readonly options structure.
 */
export interface LambdaAdapterOptions {
  readonly config?: ShukoiConfig | undefined;
  readonly basePath?: string | undefined;
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
      const path = event.rawPath ?? event.path ?? '/';

      let url = `http://localhost${path}`;
      if (event.rawQueryString) {
        url += `?${event.rawQueryString}`;
      } else if (event.queryStringParameters) {
        const q = new URLSearchParams(event.queryStringParameters).toString();
        if (q) {
          url += `?${q}`;
        }
      }

      const headers = new Headers();
      if (event.headers) {
        for (const [k, v] of Object.entries(event.headers)) {
          if (v) {
            headers.set(k, v);
          }
        }
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

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((val, key) => {
        responseHeaders[key] = val;
      });

      const responseBody = await response.text();

      return {
        statusCode: response.status,
        headers: responseHeaders,
        body: responseBody,
        isBase64Encoded: false,
      };
    } catch (err) {
      const isTimeout = abortController.signal.aborted;
      const status = isTimeout ? 504 : 500;
      const message = err instanceof Error ? err.message : String(err);

      return {
        statusCode: status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: isTimeout ? 'Gateway Timeout: Lambda deadline exceeded' : 'Internal Server Error',
          detail: message,
        }),
        isBase64Encoded: false,
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  };
}
