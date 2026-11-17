# Distributed Idempotency

> **Guaranteed exactly-once execution for state-mutating actions across distributed clusters.**

In distributed architectures—such as microservices running on Kubernetes, serverless functions on AWS Lambda, or edge workers across Cloudflare's global network—network partitions, client retries, and webhook redeliveries frequently trigger duplicate requests.

Shukoi provides a first-class, protocol-level idempotency subsystem that guarantees **exactly-once execution semantics** without polluting domain business logic.

---

## 1. How Idempotency Works in Shukoi

When an action declares `http: { requireIdempotencyKey: true }`, Shukoi's 8-step execution pipeline intercepts incoming requests before the handler logic executes:

```
[Client Request with Idempotency-Key]
                  │
                  ▼
       [Atomic State Evaluation]
                  ├── 1. Key Not Found ──────► Acquire Lock (IN_PROGRESS) ──► Execute Handler ──► Store Response & TTL
                  ├── 2. Key IN_PROGRESS ────► Reject with 409 Conflict (Concurrent Request)
                  └── 3. Key COMPLETED ──────► Return Cached Response (Emit Header: Idempotent-Replayed: true)
```

1. **Lock Acquisition:** Atomically claims an execution lock keyed by `actionName:idempotencyKey`.
2. **Execution Guard:** If another concurrent invocation holds the lock, Shukoi immediately halts execution and returns an RFC 9457 `409 Conflict` Problem Details response.
3. **Completion & Replay:** Once the handler succeeds, the response payload is cached with a configurable retention TTL. Subsequent identical requests receive the cached result instantly, tagged with `Idempotent-Replayed: true`.
4. **Failure Recovery:** If the action throws an unhandled exception, the lock is automatically released so subsequent retries are not blocked.

---

## 2. Choosing an Idempotency Store

| Store | Package | Best For | Invariant |
| :--- | :--- | :--- | :--- |
| **`InMemoryIdempotencyStore`** | `@shukoi/core` | Single-instance containers, development, and unit testing | Bounded LRU cache (`maxEntries: 10_000`); $O(1)$ memory ceiling |
| **`RedisIdempotencyStore`** | `@shukoi/store-redis` | Multi-pod Kubernetes, AWS Lambda, Cloudflare Workers, and distributed production | Single-tick atomic Lua scripts; dual runtime (`./node` and `./edge`) |

---

## 3. Configuring Distributed Idempotency with `@shukoi/store-redis`

### Installation

```bash
pnpm add @shukoi/store-redis @shukoi/core
```

### Option A: Persistent Node.js / Bun Containers (ioredis & node-redis)

In long-running servers, connect using standard TCP socket clients normalized via `wrapRedisClient()`:

```typescript
import { createRestRouter } from '@shukoi/api';
import { createSelfHostServer } from '@shukoi/selfhost';
import { createRedisIdempotencyStore, wrapRedisClient } from '@shukoi/store-redis/node';
import Redis from 'ioredis';
import { orderAction } from './actions/order.js';
import { config } from './config.js';

const redisClient = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: 3,
  commandTimeout: 5000,
});

const idempotencyStore = createRedisIdempotencyStore({
  client: wrapRedisClient(redisClient),
  keyPrefix: 'app:idemp:',
  defaultLockTtlMs: 30_000,          // Lock expires in 30s if worker crashes
  defaultRetentionTtlMs: 86_400_000, // Retain completed response for 24 hours
});

const app = createRestRouter([orderAction], config, { idempotencyStore });
export const server = createSelfHostServer(app, config);
```

### Option B: Cloudflare Workers (V8 Isolates via Upstash REST)

Edge runtimes cannot open raw TCP sockets without special socket flags. Use `@shukoi/store-redis/edge` with `UpstashRedisClient` for pure Web-standard fetch requests with **zero `node:*` imports**:

```typescript
import { createRestRouter } from '@shukoi/api';
import { toCloudflareWorker, getCloudflareContext } from '@shukoi/cloudflare';
import { createRedisIdempotencyStore, UpstashRedisClient } from '@shukoi/store-redis/edge';
import { orderAction } from './actions/order.js';
import { config } from './config.js';

// Define the REST router
export const app = createRestRouter([orderAction], config);

// Export worker entrypoint with toCloudflareWorker(app)
export default toCloudflareWorker(app);
```

> **Upstash Note:** When using the official `@upstash/redis` client instead of `UpstashRedisClient`, instantiate it with `{ automaticDeserialization: false }` to prevent double-deserialization issues with cached idempotency records.

---

### Heartbeat Lock Extension (`extendLock`)

For long-running background tasks or asynchronous processing, workers can periodically renew their active in-progress lock before it expires:

```typescript
// Background heartbeat renewing lock TTL every 10 seconds
const heartbeat = setInterval(async () => {
  const renewed = await idempotencyStore.extendLock('createPayment', idempotencyKey, 30_000);
  if (!renewed) {
    clearInterval(heartbeat);
  }
}, 10_000);

try {
  await processPayment();
} finally {
  clearInterval(heartbeat);
}
```

---

## 4. Declaring an Idempotent Action

To mandate idempotency on an action, configure the `http` routing block:

```typescript
import { defineAction } from '@shukoi/core';
import { Type } from '@sinclair/typebox';

export const createPaymentAction = defineAction({
  name: 'createPayment',
  summary: 'Processes customer credit card payment',
  description: 'Mutates billing account; mandates idempotency key',
  authRequired: true,
  http: {
    method: 'POST',
    path: '/api/v1/payments',
    successStatus: 201,
    requireIdempotencyKey: true,
    idempotencyHeaderName: 'idempotency-key', // default
  },
  input: Type.Object({
    amountCents: Type.Integer({ minimum: 100 }),
    currency: Type.String({ minLength: 3, maxLength: 3 }),
  }),
  output: Type.Object({
    transactionId: Type.String(),
    status: Type.String(),
  }),
  async handler(input, ctx) {
    ctx.logger.info('Processing payment', { amount: input.amountCents });
    
    // Perform charge...
    return {
      transactionId: crypto.randomUUID(),
      status: 'CAPTURED',
    };
  },
});
```

When called with `Idempotency-Key: pay_req_abc123`:
1. The first call executes the handler, captures the charge, and returns HTTP 201.
2. If the client disconnects or times out and retries with the same `Idempotency-Key: pay_req_abc123`, the handler **does not execute again**. Shukoi returns the cached 201 response with `Idempotent-Replayed: true`.
