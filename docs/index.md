---
layout: home

hero:
  name: "Shukoi"
  text: "The Universal Action Framework"
  tagline: "Author once in pure TypeScript. Expose simultaneously as REST, OpenAPI 3.1.0, and Model Context Protocol (MCP) across Cloudflare Workers, AWS Lambda, Node, and Bun."
  image:
    src: /logo.svg
    alt: Shukoi Framework Logo
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Interactive API
      link: /reference/api
    - theme: alt
      text: View on GitHub
      link: https://github.com/shukoilab/shukoi

features:
  - icon: ⚡
    title: 1-File Tri-Transport
    details: Declare schema, validation, idempotency, REST routing, and MCP agent tools in a single unified TypeScript action under 60 lines.
  - icon: 🛡️
    title: Pure Web-Standard Core
    details: Zero node:* built-in dependencies in core. 100% compatible with Cloudflare Workers V8 Isolates, AWS Lambda, Node 22 LTS, and Bun 1.2+.
  - icon: 🔒
    title: Stream-Bounded OOM Defense
    details: Reads HTTP request bodies chunk-by-chunk with cumulative byte counters, aborting oversized payloads with RFC 9457 HTTP 413 immediately.
  - icon: 🤖
    title: Built for Autonomous AI Agents
    details: Native Model Context Protocol (MCP 2024-11-05) support with tools, dynamic RFC 6570 resources, prompts, and sterile STDIO process watchdogs.
  - icon: 🎯
    title: Adaptive TypeBox Validation
    details: Probes isolate JIT execution at boot. Runs compiled TypeCompiler JIT on Node/Bun and falls back to AST interpretation on Cloudflare Workers.
  - icon: 🚦
    title: Zero Memory Leaks & Zero Zombies
    details: Deeply frozen contexts, single-flight mutexes, bounded LRU caches, and SIGINT/EPIPE child process watchdogs guarantee clean teardown.
---

## What is Shukoi?

**Shukoi** is an enterprise-grade TypeScript micro-framework designed to eliminate architectural duplication across the modern full-stack ecosystem. Instead of authoring separate controllers, OpenAPI schemas, validation pipelines, and LLM agent tool definitions, Shukoi unifies business logic into **declarative actions**.

A single action file simultaneously powers:
1. **Web REST Endpoints:** High-performance HTTP routing powered by Hono with deterministic parameter merge priority ($\text{Query} < \text{Body} < \text{Path}$).
2. **Living OpenAPI 3.1.0 Specs:** Automatically synchronized API documentation with auto-extracted query parameters and security schemes.
3. **Model Context Protocol (MCP):** Connects AI coding agents (Claude Desktop, Cursor, OpenCode, Antigravity) directly to your production services.

---

## The 1-File Action Pattern

Here is what authoring a production feature looks like in Shukoi—complete with schema validation, REST exposure, idempotency locks, composite cancellation, and MCP tool discovery:

```typescript
import { Type } from '@sinclair/typebox';
import { defineAction, DomainError } from '@shukoi/core';

export const processPaymentAction = defineAction({
  name: 'processPayment',
  summary: 'Authorizes and captures a credit card payment with idempotency guarantee',
  authRequired: true,
  input: Type.Object(
    {
      amount: Type.Integer({ minimum: 100, description: 'Amount in cents' }),
      currency: Type.String({ minLength: 3, maxLength: 3, description: 'ISO 4217 code' }),
      customerId: Type.String({ description: 'Customer identifier' }),
    },
    { additionalProperties: false }
  ),
  output: Type.Object(
    {
      transactionId: Type.String(),
      status: Type.Literal('SUCCEEDED'),
      amount: Type.Integer(),
      currency: Type.String(),
    },
    { additionalProperties: false }
  ),
  http: {
    method: 'POST',
    path: '/api/v1/payments',
    successStatus: 201,
    requireIdempotencyKey: true,
  },
  mcp: {
    enabled: true,
    entityType: 'tool',
    annotations: { destructiveHint: true, idempotentHint: true },
  },
  async handler(input, ctx) {
    ctx.logger.info('Processing payment', { customerId: input.customerId, amount: input.amount });
    
    // ctx.signal combines client disconnect, request timeout, and container deadline
    const response = await fetch('https://payment-gateway.internal/charge', {
      method: 'POST',
      body: JSON.stringify(input),
      signal: ctx.signal,
    });

    if (!response.ok) {
      throw new DomainError('PAYMENT_REJECTED', 'Gateway declined the transaction', {
        status: 402,
        expose: true,
      });
    }

    return {
      transactionId: `txn_${Date.now()}`,
      status: 'SUCCEEDED',
      amount: input.amount,
      currency: input.currency,
    };
  },
});
```

---

## Quickstart in 60 Seconds

Create a brand new production-ready Shukoi service in seconds using the official interactive scaffolder:

::: code-group

```bash [pnpm]
pnpm create shukoi@latest my-service
```

```bash [npm]
npm create shukoi@latest my-service
```

```bash [bun]
bun create shukoi@latest my-service
```

:::

Select your desired deployment target (**Cloudflare Workers**, **AWS Lambda**, or **Self-Host Server**), install dependencies, and start building immediately.
