/**
 * @purpose In-memory testing mocks and factories for AWS Lambda runtime events and execution context.
 * @rationale Enables ultra-fast unit and integration testing of AWS Lambda targeted Shukoi actions in Vitest without requiring SAM CLI, Docker, or live AWS infrastructure.
 * @preconditions Vitest or Web-Standard test runner; pure JavaScript runtime.
 * @invariants Pure in-memory state; deterministic fixtures; zero external network dependencies.
 */

import type { LambdaContext, LambdaHttpEvent } from './index.js';

/**
 * @purpose Factory for lightweight in-memory AWS Lambda execution context test double.
 * @rationale Allows actions and adapter handlers to be tested with predictable timeout countdowns and function metadata.
 * @preconditions Optional partial overrides for LambdaContext properties.
 * @param overrides Partial LambdaContext properties to override default test double values.
 * @returns Instantiated LambdaContext test double.
 * @throws Never throws on instantiation.
 * @invariants Deterministic default values; getRemainingTimeInMillis returns configured millisecond budget.
 */
export function createMockLambdaContext(overrides?: Partial<LambdaContext>): LambdaContext {
  const remainingTime = overrides?.getRemainingTimeInMillis
    ? overrides.getRemainingTimeInMillis
    : () => 30000;

  return {
    getRemainingTimeInMillis: remainingTime,
    functionName: overrides?.functionName ?? 'mock-shukoi-function',
    functionVersion: overrides?.functionVersion ?? '$LATEST',
    invokedFunctionArn:
      overrides?.invokedFunctionArn ??
      'arn:aws:lambda:us-east-1:123456789012:function:mock-shukoi-function',
    memoryLimitInMB: overrides?.memoryLimitInMB ?? '512',
    awsRequestId: overrides?.awsRequestId ?? 'mock-aws-request-id-12345',
  };
}

/**
 * @purpose Factory for AWS API Gateway v2 (HTTP API / Function URL) ingress event test double.
 * @rationale Synthesizes format 2.0 payloads with cookies, rawPath, and nested requestContext.
 * @preconditions Optional partial overrides for LambdaHttpEvent properties.
 * @param options Partial LambdaHttpEvent properties to customize path, method, headers, or cookies.
 * @returns Instantiated LambdaHttpEvent representing an API Gateway v2 event.
 * @throws Never throws on instantiation.
 * @invariants Conforms to AWS API Gateway Payload Format 2.0.
 */
export function createMockApiGatewayV2Event(options?: Partial<LambdaHttpEvent>): LambdaHttpEvent {
  const path = options?.rawPath ?? options?.path ?? '/';
  const method = options?.httpMethod ?? 'GET';

  return {
    version: '2.0',
    rawPath: path,
    path,
    httpMethod: method,
    headers: {
      'content-type': 'application/json',
      host: 'localhost',
      ...(options?.headers ?? {}),
    },
    cookies: options?.cookies ?? [],
    queryStringParameters: options?.queryStringParameters,
    rawQueryString: options?.rawQueryString,
    body: options?.body,
    isBase64Encoded: options?.isBase64Encoded ?? false,
    requestContext: {
      stage: '$default',
      http: {
        method,
        path,
      },
      ...(options?.requestContext ?? {}),
    },
    stageVariables: options?.stageVariables,
  };
}

/**
 * @purpose Factory for AWS API Gateway v1 (REST API / ALB) ingress event test double.
 * @rationale Synthesizes format 1.0 payloads with multiValueHeaders, stage prefix, and path parameters.
 * @preconditions Optional partial overrides for LambdaHttpEvent properties.
 * @param options Partial LambdaHttpEvent properties to customize path, method, headers, or query params.
 * @returns Instantiated LambdaHttpEvent representing an API Gateway v1 / ALB event.
 * @throws Never throws on instantiation.
 * @invariants Conforms to AWS API Gateway Payload Format 1.0.
 */
export function createMockApiGatewayV1Event(options?: Partial<LambdaHttpEvent>): LambdaHttpEvent {
  const path = options?.path ?? options?.rawPath ?? '/';
  const method = options?.httpMethod ?? 'GET';

  return {
    version: '1.0',
    path,
    rawPath: path,
    httpMethod: method,
    headers: {
      'content-type': 'application/json',
      host: 'localhost',
      ...(options?.headers ?? {}),
    },
    multiValueHeaders: options?.multiValueHeaders,
    queryStringParameters: options?.queryStringParameters,
    multiValueQueryStringParameters: options?.multiValueQueryStringParameters,
    rawQueryString: options?.rawQueryString,
    body: options?.body,
    isBase64Encoded: options?.isBase64Encoded ?? false,
    requestContext: {
      stage: 'prod',
      ...(options?.requestContext ?? {}),
    },
    stageVariables: options?.stageVariables,
  };
}
