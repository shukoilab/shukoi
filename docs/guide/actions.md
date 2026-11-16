# The Action Pattern

The **Action** is the fundamental atomic building block in Shukoi. An action encapsulates business logic, schema validation, protocol routing, and operational invariants in a single, protocol-agnostic definition.

---

## The Philosophy of Protocol-Agnostic Actions

In conventional backend frameworks, developers write:
1. An HTTP Controller with manual request body parsing and query param extraction.
2. A separate OpenAPI DTO schema that drifts out of sync over time.
3. Middleware for authentication, idempotency, and error formatting.
4. An MCP Tool definition duplicating the controller's schemas and capabilities for AI agents.

In Shukoi, **all four boundaries are derived from a single `defineAction` invocation**. Business handlers never interact with raw HTTP `Request` or `Response` objects or JSON-RPC protocol envelopes. Handlers receive strictly typed, sanitized data and return a clean domain object.

---

## Anatomy of an Action

```typescript
import { Type } from '@sinclair/typebox';
import { defineAction } from '@shukoi/core';

export const updateAccountAction = defineAction({
  // 1. Metadata
  name: 'updateAccount',
  summary: 'Updates account profile and notification preferences',
  description: 'Applies partial profile updates with tenant-isolated database mutations.',
  authRequired: true,

  // 2. Strict Input Schema
  input: Type.Object(
    {
      id: Type.String({ description: 'Account ID in URL path' }),
      displayName: Type.Optional(Type.String({ minLength: 2, maxLength: 50 })),
      notificationsEnabled: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false } // Required invariant
  ),

  // 3. Strict Output Schema
  output: Type.Object(
    {
      id: Type.String(),
      displayName: Type.String(),
      notificationsEnabled: Type.Boolean(),
      updatedAt: Type.String({ format: 'date-time' }),
    },
    { additionalProperties: false }
  ),

  // 4. REST Exposure (Protocol Module A)
  http: {
    method: 'PATCH',
    path: '/api/v1/accounts/:id',
    successStatus: 200,
  },

  // 5. Model Context Protocol Exposure (Protocol Module B)
  mcp: {
    enabled: true,
    entityType: 'tool',
    annotations: {
      destructiveHint: false,
      idempotentHint: true,
    },
  },

  // 6. Protocol-Agnostic Handler
  async handler(input, ctx) {
    // input is guaranteed valid, typed, and stripped of unvalidated properties
    ctx.logger.info('Updating account', { accountId: input.id });

    // Execute database update propagating composite cancellation signal
    const updated = await ctx.services.db.accounts.update({
      where: { id: input.id, tenantId: ctx.auth?.tenantId },
      data: {
        displayName: input.displayName,
        notificationsEnabled: input.notificationsEnabled,
      },
      signal: ctx.signal,
    });

    return {
      id: updated.id,
      displayName: updated.displayName,
      notificationsEnabled: updated.notificationsEnabled,
      updatedAt: updated.updatedAt.toISOString(),
    };
  },
});
```

---

## Action Execution Context (`ActionExecutionContext`)

Every action handler receives a deeply frozen `ActionExecutionContext` (`ctx`):

| Property | Type | Description |
| :--- | :--- | :--- |
| `ctx.signal` | `AbortSignal` | Unified composite abort signal combining client disconnects, configured timeouts, and container deadlines. |
| `ctx.logger` | `ShukoiLogger` | Structured JSON logger that routes strictly to `process.stderr`, preserving `stdout` sterility for MCP STDIO. |
| `ctx.auth` | `AuthContext \| undefined` | Verified user identity and claims (from Bearer JWT or API key). |
| `ctx.idempotencyKey` | `string \| undefined` | Caller-provided idempotency key for deduplication. |
| `ctx.services` | `Record<string, unknown>` | Injected dependencies (database pools, payment gateways, cache clients). |
| `ctx.platform` | `unknown` | Platform-specific context doubles (e.g. Cloudflare `env` or Lambda `context`). |

---

## The Twelve Action Invariants

When authoring actions in Shukoi, always uphold these non-negotiable rules:

1. **Always enable `{ additionalProperties: false }`** on every `Type.Object` schema in `input` and `output` to prevent prototype pollution and schema smuggling.
2. **Never import `node:*` modules** inside action files. Keep core actions 100% Web-Standard compatible.
3. **Never touch raw HTTP objects** (`Request`, `Response`, `Headers`) or JSON-RPC frames inside the handler.
4. **Never call `console.log`**. Use `ctx.logger.info()` or `ctx.logger.error()` instead.
5. **Always pass `ctx.signal`** to all outbound database queries and HTTP `fetch()` requests.
6. **Output data is automatically sanitized**: Return values pass through `Value.Clean(outputSchema, result)`, automatically stripping unexposed ORM fields (such as internal password hashes or tenant salts) before sending to clients.
