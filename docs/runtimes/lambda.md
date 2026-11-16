# AWS Lambda Adapter (`@shukoi/lambda`)

`@shukoi/lambda` adapts Shukoi applications to AWS Lambda serverless execution across API Gateway v1 (REST), API Gateway v2 (HTTP), and Application Load Balancer (ALB) events.

---

## Architectural Highlights

- **Dynamic Deadline Subtraction:** Reads `context.getRemainingTimeInMillis()`, subtracts an emergency buffer (default 500 ms), and injects a timed abort signal into `ctx.signal`. This guarantees in-flight transactions execute clean compensation logic before AWS forcefully terminates the container.
- **Protocol Parity:** Seamlessly handles API Gateway v2, API Gateway v1, and ALB payload envelopes.
- **Full Egress Cookie Preservation:** Extracts multiple `Set-Cookie` headers into `cookies` arrays or comma-delimited strings based on target protocol rules.
- **Automatic Base64 Encoding:** Automatically detects binary media types (e.g. `image/png`, `application/pdf`) and Base64-encodes the response payload.
- **In-Memory Testing Doubles (`@shukoi/lambda/testing`):** Mock Lambda contexts and API Gateway v1/v2 events for instantaneous testing without SAM CLI or Docker.

---

## Entrypoint Implementation (`src/entries/lambda.ts`)

```typescript
import { createRestRouter } from '@shukoi/api';
import { toLambdaHandler, getLambdaContext } from '@shukoi/lambda';
import { createDefaultConfig } from '@shukoi/core';
import { actions } from '../actions/index.js';

const config = createDefaultConfig();
const app = createRestRouter(actions, config);

// Export standard AWS Lambda ESM handler
export const handler = toLambdaHandler(app, {
  deadlineBufferMs: 500, // Reserve 500ms for graceful cleanup
  injectServices: (event, context) => ({
    awsRequestId: context.awsRequestId,
  }),
});
```

---

## Accessing Typed Lambda Context in Actions

```typescript
import { getLambdaContext } from '@shukoi/lambda';

export const inspectLambdaAction = defineAction({
  name: 'inspectLambda',
  http: { method: 'GET', path: '/api/v1/lambda-info' },
  async handler(input, ctx) {
    const lambda = getLambdaContext(ctx);
    
    return {
      awsRequestId: lambda?.context.awsRequestId,
      functionName: lambda?.context.functionName,
      remainingTimeMs: lambda?.context.getRemainingTimeInMillis(),
    };
  },
});
```

---

## In-Memory Testing (`@shukoi/lambda/testing`)

```typescript
import { describe, it, expect } from 'vitest';
import { createMockLambdaContext, createMockApiGatewayV2Event } from '@shukoi/lambda/testing';

describe('Lambda Handler Testing', () => {
  it('handles simulated API Gateway v2 HTTP events', async () => {
    const mockContext = createMockLambdaContext({ remainingTimeMs: 15000 });
    const mockEvent = createMockApiGatewayV2Event({
      routeKey: 'POST /api/v1/payments',
      rawPath: '/api/v1/payments',
      body: JSON.stringify({ amount: 1000 }),
    });

    expect(mockContext.getRemainingTimeInMillis()).toBe(15000);
    expect(mockEvent.requestContext.http.method).toBe('POST');
  });
});
```
