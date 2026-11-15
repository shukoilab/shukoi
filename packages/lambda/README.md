# @shukoi/lambda

> **AWS Lambda Runtime Adapter with Dynamic Deadline Subtraction for Shukoi Applications**

[![npm version](https://img.shields.io/npm/v/@shukoi/lambda.svg)](https://www.npmjs.com/package/@shukoi/lambda)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`@shukoi/lambda` adapts Shukoi Hono applications to AWS Lambda running on Node.js 22+ ESM. It supports API Gateway v1 (REST API), API Gateway v2 (HTTP API), Application Load Balancers (ALB), and Lambda Function URLs. Crucially, it calculates container execution deadlines dynamically, aborting operations early to prevent uncommitted database transactions from freezing inside suspended Lambda microVMs.

---

## Key Features & Invariants

- **Universal AWS Ingress Translation:** Seamlessly translates API Gateway v1, API Gateway v2, ALB, and Function URL event payloads into Web-standard `Request` objects and maps responses back to Lambda Proxy result objects.
- **Dynamic Deadline Calculation:** Monitors container timeout countdown via `context.getRemainingTimeInMillis()`:
  $$\text{effectiveTimeoutMs} = \min(\text{actionTimeoutMs}, \text{context.getRemainingTimeInMillis()} - \text{config.limits.lambdaDeadlineBufferMs})$$
- **Early 504 Gateway Timeout:** If remaining container execution time minus safety margin is $\le 0$, the adapter immediately returns HTTP 504 Gateway Timeout without initiating database connections or business logic.
- **Clean Container Freeze:** Automatically aborts `ctx.signal` at the calculated deadline, ensuring in-flight database transactions roll back cleanly before AWS freezes the execution environment.

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

### 2. Infrastructure Deployment (AWS SAM / Serverless)

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31
Resources:
  ShukoiFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: dist/entries/lambda.handler
      Runtime: nodejs22.x
      Timeout: 30
      MemorySize: 512
      Events:
        HttpApi:
          Type: HttpApi
```

---

## API Reference

### `toLambdaHandler(app, options?)`

Adapts a Hono application into an AWS Lambda handler:

```typescript
export function toLambdaHandler(
  app: Hono,
  options?: LambdaAdapterOptions,
): (event: LambdaHttpEvent, context: LambdaContext) => Promise<LambdaProxyResult>;
```

---

## License

MIT © [Shukoi Contributors](https://github.com/shukoilab/shukoi)
