# @shukoi/lambda

> **AWS Lambda Runtime Adapter with Dynamic Deadline Subtraction and Typed Context for Shukoi Applications**

[![npm version](https://img.shields.io/npm/v/@shukoi/lambda.svg)](https://www.npmjs.com/package/@shukoi/lambda)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`@shukoi/lambda` adapts Shukoi Hono applications to AWS Lambda running on Node.js 22+ ESM. It supports API Gateway v1 (REST API), API Gateway v2 (HTTP API), Application Load Balancers (ALB), and Lambda Function URLs. Crucially, it calculates container execution deadlines dynamically, aborting operations early to prevent uncommitted database transactions from freezing inside suspended Lambda microVMs.

---

## Key Features & Invariants

- **Universal AWS Ingress Translation:** Seamlessly translates API Gateway v1, API Gateway v2, ALB, and Function URL event payloads into Web-standard `Request` objects and maps responses back to Lambda Proxy result objects.
- **Typed Platform Context (`getLambdaContext`):** Ergonomic access to `context` (`awsRequestId`, `getRemainingTimeInMillis()`, `invokedFunctionArn`) and `event` (`stageVariables`, `authorizer` claims) directly inside action handlers.
- **Full Cookie Normalization:** Reads `event.cookies` array on API Gateway v2 HTTP APIs and sets outgoing `result.cookies` array using Web-standard `res.headers.getSetCookie()`.
- **Automatic Binary Response Encoding:** Automatically detects binary MIME types (`image/*`, `application/pdf`, `application/octet-stream`, etc.) via `defaultIsContentTypeBinary` and encodes responses to Base64 with `isBase64Encoded: true`.
- **Dynamic Deadline Calculation:** Monitors container timeout countdown via `context.getRemainingTimeInMillis()`:
  $$\text{effectiveTimeoutMs} = \min(\text{defaultTimeoutMs}, \text{context.getRemainingTimeInMillis()} - \text{config.limits.lambdaDeadlineBufferMs})$$
- **Early 504 Gateway Timeout:** If remaining container execution time minus safety margin is $\le 0$, the adapter immediately returns HTTP 504 Gateway Timeout in RFC 9457 `application/problem+json` without initiating database connections or business logic.
- **In-Memory Testing Doubles (`@shukoi/lambda/testing`):** Mock Lambda contexts and API Gateway v1/v2 events in Vitest in 1ms without SAM CLI or Docker.

---

## Installation

```bash
pnpm add @shukoi/lambda @shukoi/api @shukoi/core hono
# or
npm install @shukoi/lambda @shukoi/api @shukoi/core hono
# or
bun add @shukoi/lambda @shukoi/api @shukoi/core hono
```

---

## Usage

### 1. Lambda Handler Entrypoint (`src/entries/lambda.ts`)

```typescript
import { createRestRouter } from '@shukoi/api';
import { toLambdaHandler } from '@shukoi/lambda';
import { createDefaultConfig } from '@shukoi/core';
import { myAction } from '../actions/myAction.js';

const config = createDefaultConfig({
  limits: {
    lambdaDeadlineBufferMs: 500, // 500ms safety buffer
  },
});

const app = createRestRouter([myAction], config);

// Exports AWS Lambda handler accepting (event, context)
export const handler = toLambdaHandler(app, { config });
```

### 2. Accessing Lambda Context in Actions (`getLambdaContext`)

```typescript
import { defineAction } from '@shukoi/core';
import { getLambdaContext } from '@shukoi/lambda';
import { Type } from '@sinclair/typebox';

export const myAction = defineAction({
  name: 'myAction',
  input: Type.Object({ orderId: Type.String() }),
  output: Type.Object({ success: Type.Boolean(), awsRequestId: Type.String() }),
  async handler(input, ctx) {
    // 100% Type-Safe access to Lambda runtime context and event
    const { context, getRemainingTimeInMillis } = getLambdaContext(ctx);

    ctx.logger.info(`Processing order ${input.orderId} (AWS Request ID: ${context.awsRequestId})`);
    ctx.logger.info(`Remaining execution time budget: ${getRemainingTimeInMillis()}ms`);

    return {
      success: true,
      awsRequestId: context.awsRequestId ?? 'unknown',
    };
  },
});
```

### 3. In-Memory Testing (`@shukoi/lambda/testing`)

Test your Lambda handlers and actions in Vitest without Docker or AWS credentials:

```typescript
import { describe, expect, it } from 'vitest';
import { createMockApiGatewayV2Event, createMockLambdaContext } from '@shukoi/lambda/testing';
import { handler } from '../src/entries/lambda.js';

describe('Lambda Handler Integration', () => {
  it('handles API Gateway v2 event and sets cookies', async () => {
    const mockContext = createMockLambdaContext({
      awsRequestId: 'test-req-123',
      getRemainingTimeInMillis: () => 10000,
    });

    const mockEvent = createMockApiGatewayV2Event({
      rawPath: '/api/orders',
      httpMethod: 'POST',
      body: JSON.stringify({ orderId: 'ord-101' }),
      cookies: ['sessionId=abc123xyz'],
    });

    const result = await handler(mockEvent, mockContext);
    expect(result.statusCode).toBe(200);
  });
});
```

### 4. AWS SAM Infrastructure Deployment (`template.yaml`)

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31
Description: Shukoi AWS Lambda Service

Globals:
  Function:
    Timeout: 30
    MemorySize: 512
    Runtime: nodejs22.x
    Architectures:
      - arm64

Resources:
  HttpApiFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: .
      Handler: dist/lambda.mjs.handler
      Events:
        HttpApiCatchAll:
          Type: HttpApi
          Properties:
            Path: /{proxy+}
            Method: ANY
        HttpApiRoot:
          Type: HttpApi
          Properties:
            Path: /
            Method: ANY

Outputs:
  HttpApiUrl:
    Description: HTTP API Gateway endpoint URL
    Value: !Sub "https://${ServerlessHttpApi}.execute-api.${AWS::Region}.amazonaws.com"
```

---

## API Reference

### `toLambdaHandler(app, options?)`

Adapts a Hono application into an AWS Lambda handler accepting `(event, context)`.

### `getLambdaContext<TEvent, TContext>(ctx)`

Extracts strongly-typed AWS Lambda runtime context (`awsRequestId`, `getRemainingTimeInMillis()`) and raw ingress event from `ActionExecutionContext`.

### `defaultIsContentTypeBinary(contentType)`

Built-in predicate identifying binary MIME types that require Base64 response encoding on AWS Lambda.

### `@shukoi/lambda/testing`

- `createMockLambdaContext(overrides?)`: In-memory `LambdaContext` test double.
- `createMockApiGatewayV2Event(options?)`: In-memory API Gateway v2 (HTTP API / Function URL) event fixture.
- `createMockApiGatewayV1Event(options?)`: In-memory API Gateway v1 (REST API / ALB) event fixture.

---

## Related Documentation & Architecture

- **System Architecture:** [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) (Deep dive into dynamic deadline subtraction and event translation).
- **Deployment Skill:** [skills/shukoi-deploy-target](../../skills/shukoi-deploy-target/SKILL.md) (Step-by-step deployment and operational guidance).
- **Runtime Comparison Matrix:** [Runtime Matrix](../../skills/shukoi-deploy-target/references/runtime-matrix.md) (Capabilities across Cloudflare, Lambda, and Self-Host).

---

## License

MIT © [Shukoi Contributors](https://github.com/shukoilab/shukoi)
