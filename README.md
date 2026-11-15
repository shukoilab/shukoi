# SHUKOI (`@shukoi/*`)

> **Write-Once Contract-First TypeScript Micro-Framework**  
> 1 Core Engine $\rightarrow$ 2 Protocol Modules $\rightarrow$ 3 Product Outputs $\rightarrow$ 3 Runtime Targets

[![CI Quality Gates](https://github.com/shukoilab/shukoi/actions/workflows/ci.yml/badge.svg)](https://github.com/shukoilab/shukoi/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript: 5.7+](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)

---

## Overview

Shukoi enables software engineers to define business logic, input/output schemas, security policies, and execution metadata once in a **single declarative file (`defineAction`)**, automatically exposing three production-ready interfaces:

1. **REST API + OpenAPI 3.1.0 Specification** (via `@shukoi/api`)
2. **MCP Streamable HTTP Server** (via `@shukoi/mcp/http`)
3. **MCP STDIO Local Server & Remote HTTP Bridge** (via `@shukoi/mcp/stdio`)

Deployable without code modification across:
- **Cloudflare Workers** (V8 Isolates via `@shukoi/cloudflare`)
- **AWS Lambda** (Node.js 22+ ESM via `@shukoi/lambda`)
- **Self-Host** (Bun 1.2+ / Node.js 22+ / Docker via `@shukoi/selfhost`)

---

## The 1-File Action Pattern

```typescript
import { Type } from '@sinclair/typebox';
import { defineAction, DomainError } from '@shukoi/core';

export const calculateDiscount = defineAction({
  name: 'calculateDiscount',
  summary: 'Calculates discounted order price',
  description: 'Applies promotional percentage discount with input boundary validation',
  authRequired: false,
  http: {
    method: 'POST',
    path: '/discount',
    successStatus: 200,
  },
  mcp: {
    enabled: true,
    entityType: 'tool',
    annotations: { readOnlyHint: true },
  },
  input: Type.Object(
    {
      price: Type.Number({ minimum: 0, description: 'Original price' }),
      percent: Type.Number({ minimum: 0, maximum: 100, description: 'Discount percentage' }),
    },
    { additionalProperties: false },
  ),
  output: Type.Object(
    {
      finalPrice: Type.Number({ description: 'Price after discount' }),
      savedAmount: Type.Number({ description: 'Amount saved' }),
    },
    { additionalProperties: false },
  ),
  async handler(input, ctx) {
    ctx.logger.info('Calculating discount', { price: input.price });

    if (ctx.signal.aborted) {
      throw new DomainError('GATEWAY_TIMEOUT', 'Operation cancelled', 504);
    }

    const savedAmount = (input.price * input.percent) / 100;
    return {
      finalPrice: input.price - savedAmount,
      savedAmount,
    };
  },
});
```

---

## Scoped NPM Package Matrix

| Package Name | Purpose | Node.js Built-ins |
| :--- | :--- | :--- |
| **`@shukoi/core`** | Universal Action Engine, Adaptive Validator, Auth, Logger, Testing | **Forbidden** (Pure Web Standard) |
| **`@shukoi/api`** | Hono REST Router, Stream-Bounded Reader, OpenAPI 3.1.0 Generator | **Forbidden** (Pure Web Standard) |
| **`@shukoi/mcp`** | Subpaths `./http` (DNS-rebinding safe) and `./stdio` (backpressure safe) | Only in `./stdio` |
| **`@shukoi/cloudflare`**| Cloudflare Workers V8 Isolate Adapter with `executionCtx.waitUntil` | **Forbidden** (Pure Web Standard) |
| **`@shukoi/lambda`** | AWS Lambda Adapter with dynamic deadline calculation | Permitted |
| **`@shukoi/selfhost`** | Bun/Node Server with Graceful Drain State Machine & `/healthz` probes | Permitted |
| **`create-shukoi`** | Interactive Clack & CI automation project scaffolder CLI | Permitted |

---

## Scaffolding a New Service

```bash
# Interactive mode
npm create shukoi@latest my-service

# Non-interactive CI mode
npm create shukoi@latest my-service -- --products api,mcp-http --targets cloudflare,selfhost --pm pnpm
```

---

## AI Agent Integration

Shukoi provides first-class progressive disclosure documentation for autonomous AI coding agents:
- Repository Constitution: [AGENTS.md](AGENTS.md)
- Claude Code Pointer: [CLAUDE.md](CLAUDE.md)
- Architecture Specification: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Architecture Decision Records: [docs/adr/](docs/adr/)
- Agent Skills Suite (`agentskills.io`): [skills/](skills/)
- LLM Context Index: [llms.txt](llms.txt) and [llms-full.txt](llms-full.txt)

---

## Verification & Quality Gates

```bash
pnpm run lint        # Biome sub-100ms static analysis
pnpm run typecheck   # Strict TypeScript (tsc -b)
pnpm test            # All unit and integration test suites
pnpm run test:qg     # Mandatory Seven CI Quality Gates (QG-01 to QG-07)
pnpm -r run build    # Monorepo build
```

---

## License

MIT © [Shukoi Contributors](https://github.com/shukoilab/shukoi)
