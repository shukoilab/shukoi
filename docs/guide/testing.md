# Testing & In-Memory Mocks

Shukoi is engineered for **instantaneous, zero-network unit and integration testing**. Because business logic is strictly decoupled from transport layers, actions can be tested at three distinct levels of abstraction without binding live OS network sockets or running Docker containers.

---

## 1. Direct Action Testing (`executeAction`)

The fastest way to test business logic is executing the compiled action directly using `executeAction()`:

```typescript
import { describe, it, expect } from 'vitest';
import { executeAction, createDefaultConfig } from '@shukoi/core';
import { processPaymentAction } from '../src/actions/processPayment.js';

describe('processPaymentAction', () => {
  it('successfully authorizes valid payments', async () => {
    const config = createDefaultConfig();
    
    // Execute action with typed input and mock context
    const result = await executeAction(
      processPaymentAction,
      {
        amount: 5000,
        currency: 'USD',
        customerId: 'cus_9912',
      },
      {
        config,
        auth: { userId: 'usr_1', roles: ['customer'] },
        services: {
          /* Injected mock database or gateway */
        },
      }
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(result.amount).toBe(5000);
    expect(result.transactionId).toMatch(/^txn_/);
  });

  it('rejects invalid inputs during schema validation', async () => {
    const config = createDefaultConfig();

    await expect(
      executeAction(
        processPaymentAction,
        {
          amount: 50, // Minimum is 100 cents
          currency: 'INVALID', // Length must be 3
        } as any,
        { config }
      )
    ).rejects.toThrow();
  });
});
```

---

## 2. Testing HTTP REST Endpoints with Hono

Test complete HTTP request lifecycles (CORS, parameter merging, bounded stream parsing, and RFC 9457 error formatting) using Hono's in-memory `app.request()`:

```typescript
import { describe, it, expect } from 'vitest';
import { createRestRouter } from '@shukoi/api';
import { createDefaultConfig } from '@shukoi/core';
import { processPaymentAction } from '../src/actions/processPayment.js';

describe('REST Router Integration', () => {
  const config = createDefaultConfig();
  const app = createRestRouter([processPaymentAction], config);

  it('handles POST requests and returns HTTP 201', async () => {
    const res = await app.request('/api/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idemp_unique_key_1',
      },
      body: JSON.stringify({
        amount: 2500,
        currency: 'USD',
        customerId: 'cus_330',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('SUCCEEDED');
  });

  it('returns RFC 9457 404 Problem Details for unmapped routes', async () => {
    const res = await app.request('/unknown-endpoint');

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');

    const error = await res.json();
    expect(error.code).toBe('NOT_FOUND');
    expect(error.type).toBe('urn:shukoi:error:not-found');
  });
});
```

---

## 3. Testing Model Context Protocol (MCP)

Test MCP tool execution, dynamic resource templates, and prompt introspections in-memory:

```typescript
import { describe, it, expect } from 'vitest';
import { compileMcpCatalog, createScopedMcpServer } from '@shukoi/mcp/http';
import { createDefaultConfig } from '@shukoi/core';
import { processPaymentAction } from '../src/actions/processPayment.js';

describe('MCP In-Memory Execution', () => {
  const config = createDefaultConfig();
  const catalog = compileMcpCatalog([processPaymentAction]);

  it('lists registered tools with TypeBox schemas', async () => {
    const server = createScopedMcpServer(catalog, { config });
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });

    expect(response.result.tools).toHaveLength(1);
    expect(response.result.tools[0].name).toBe('processPayment');
  });

  it('executes tools and returns formatted content blocks', async () => {
    const server = createScopedMcpServer(catalog, { config });
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'processPayment',
        arguments: {
          amount: 1500,
          currency: 'USD',
          customerId: 'cus_881',
        },
      },
    });

    expect(response.result.isError).toBeFalsy();
    const content = JSON.parse(response.result.content[0].text);
    expect(content.status).toBe('SUCCEEDED');
  });
});
```

---

## 4. Platform Context Testing Doubles

Each runtime adapter exports dedicated testing doubles to verify edge-specific bindings without real cloud infrastructure:

- **Cloudflare Workers:** `import { createMockCloudflareContext, createMockD1Database, createMockKVNamespace } from '@shukoi/cloudflare/testing';`
- **AWS Lambda:** `import { createMockLambdaContext, createMockApiGatewayV2Event } from '@shukoi/lambda/testing';`
- **Self-Host Server:** `import { createMockSelfHostContext } from '@shukoi/selfhost/testing';`
