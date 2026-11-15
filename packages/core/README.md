# @shukoi/core

> **The Universal Action Engine & Adaptive Validation Core of the Shukoi Ecosystem**

[![npm version](https://img.shields.io/npm/v/@shukoi/core.svg)](https://www.npmjs.com/package/@shukoi/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Pure Web Standard](https://img.shields.io/badge/Runtime-Pure_Web_Standard-success.svg)](https://github.com/shukoilab/shukoi)

`@shukoi/core` is a platform-agnostic, zero-dependency foundational TypeScript engine designed to implement the **Write-Once Contract-First** paradigm. It empowers software engineers to define business logic, input/output validation contracts, operational limits, and security policies once in a single declarative file (`defineAction`), which can then be exposed over REST and Model Context Protocol (MCP) without code modification.

---

## Key Features & Invariants

- **Zero-Guesswork Contracts:** Strict TypeBox schema validation on all inputs and outputs.
- **Adaptive Isolate-Safe Validator:** Automatic boot-time capability detection: compiles via TypeBox JIT (`TypeCompiler`) on Node.js/Bun, and falls back to AST evaluation (`Value.Check`) on V8 Isolates (Cloudflare Workers) where dynamic code generation is restricted.
- **Single-Flight JWKS Key Discovery:** In-memory caching with TTL and an active promise mutex preventing JWKS cache stampedes under high concurrency.
- **Constant-Time Crypto:** Secret and token comparisons execute using Web Crypto SHA-256 bitwise XOR loops (`safeCompareSecrets`) to prevent timing side-channel attacks.
- **Web-Standard Sterile Logger:** Zero-dependency structured JSON logger writing exclusively to `process.stderr` (or `console.error`), preserving File Descriptor 1 (`stdout`) for clean MCP STDIO protocol frames.
- **Atomic Idempotency Locking:** Bounded in-memory LRU store with automatic TTL expiration ensuring exactly-once execution for mutating requests.
- **Composite Cancellation:** Combines transport abort signals, action timeouts, and container execution deadlines into a unified `AbortSignal.any`.
- **Pure Web-Standard Engine:** Contains zero `node:*` imports or native C++ addons, guaranteeing 100% compatibility across edge sandboxes.

---

## Installation

```bash
pnpm add @shukoi/core @sinclair/typebox jose
# or
npm install @shukoi/core @sinclair/typebox jose
# or
bun add @shukoi/core @sinclair/typebox jose
```

### Peer Dependencies

- `@sinclair/typebox` (`^0.34.0`)
- `jose` (`^5.9.6`)

---

## Quickstart: The 1-File Action Pattern

```typescript
import { Type } from '@sinclair/typebox';
import { defineAction, DomainError } from '@shukoi/core';

export const createUserAction = defineAction({
  name: 'createUser',
  summary: 'Registers a new user profile',
  description: 'Validates input, checks authorization, and stores profile data',
  authRequired: true,
  requiredScopes: ['users:write'],
  timeoutMs: 15000,
  http: {
    method: 'POST',
    path: '/users',
    successStatus: 201,
    requireIdempotencyKey: true,
  },
  mcp: {
    enabled: true,
    entityType: 'tool',
    annotations: { destructiveHint: true, idempotentHint: true },
  },
  input: Type.Object(
    {
      username: Type.String({ minLength: 3, maxLength: 32 }),
      email: Type.String({ format: 'email' }),
    },
    { additionalProperties: false },
  ),
  output: Type.Object(
    {
      id: Type.String(),
      username: Type.String(),
      createdAt: Type.String(),
    },
    { additionalProperties: false },
  ),
  async handler(input, ctx) {
    ctx.logger.info('Creating user', { username: input.username });

    if (ctx.signal.aborted) {
      throw new DomainError('GATEWAY_TIMEOUT', 'Operation aborted by caller', 504);
    }

    ctx.onFinally(async () => {
      ctx.logger.debug('Cleaning up database handles');
    });

    return {
      id: crypto.randomUUID(),
      username: input.username,
      createdAt: new Date().toISOString(),
      // Internal fields are automatically stripped before output validation
      internal_hash: 'SECRET_DO_NOT_LEAK',
    } as unknown as { id: string; username: string; createdAt: string };
  },
});
```

---

## API Reference

### `defineAction(definition)`

Creates a compiled, deeply frozen `CompiledAction` with pre-compiled TypeBox input and output validators.

### `executeAction(action, rawInput, options)`

Executes an action through the standardized 8-step pipeline:

1. Correlation Tracking & Child Logger Setup
2. Composite Cancellation Controller (`AbortSignal.any`)
3. Authentication & Scope RBAC Verification
4. Atomic Idempotency Locking
5. Input Sanitization & TypeBox Validation
6. Pure Handler Invocation
7. Output Data Sanitization (`Value.Clean`) & Contract Validation
8. Deterministic LIFO Resource Teardown (`ctx.onFinally`)

### `compileSchemaValidator(schema, forceAst?)`

Compiles a TypeBox schema into an adaptive validator object. Automatically enforces `{ additionalProperties: false }` recursively across object nodes.

### `createDefaultConfig(overrides?)` / `validateShukoiConfig(raw)`

Creates or validates strongly-typed, deeply frozen `ShukoiConfig` objects containing `security`, `limits`, and `observability` thresholds.

### `DomainError(code, detail, statusCode?, errors?)`

Typed error exception class that maps operational failures to RFC 9457 Problem Details (`application/problem+json`).

---

## Testing Harness: `@shukoi/core/testing`

Test actions without spinning up full HTTP or MCP network servers:

```typescript
import { describe, it, expect } from 'vitest';
import { createActionTestHarness } from '@shukoi/core/testing';
import { createUserAction } from './createUser.js';

describe('createUserAction', () => {
  it('creates user profile successfully', async () => {
    const harness = createActionTestHarness();
    const result = await harness.execute(
      createUserAction,
      { username: 'alice', email: 'alice@example.com' },
      { headers: { 'x-api-key': 'valid-key' }, staticApiKeys: { 'valid-key': { id: 'usr-1' } } },
    );
    expect(result.id).toBeDefined();
    expect(result.username).toBe('alice');
  });
});
```

---

## License

MIT © [Shukoi Contributors](https://github.com/shukoilab/shukoi)
