---
name: shukoi-create-action
description: Creates or modifies protocol-agnostic business actions in Shukoi using defineAction(), TypeBox strict schemas, DomainError, and AbortSignal cancellation. Use whenever adding a new REST API endpoint, MCP tool, MCP resource, or MCP prompt in a @shukoi/core codebase.
compatibility: TypeScript 5.5+, @sinclair/typebox, @shukoi/core
---

# Authoring a Shukoi Action (1-File Tri-Transport Pattern)

## Strict Rules
1. Never import `node:*` modules or raw HTTP `Request`/`Response` objects inside an action file.
2. Always set `{ additionalProperties: false }` on every `Type.Object(...)` in `input` and `output`.
3. Never hardcode timeouts, secrets, or URLs; read them from `ctx.services` or `ShukoiConfig`.
4. Never use `console.log`; always use `ctx.logger.info(...)` or `ctx.logger.error(...)` (routed to `stderr`).
5. Always pass `ctx.signal` to downstream database queries and HTTP `fetch` calls.

## Step-by-Step Implementation

1. **Define Input & Output Schemas**: Create TypeBox schemas in `src/actions/<domain>-<verb>.ts` with descriptive metadata on every property (used automatically by OpenAPI 3.1 and LLM tool schemas).
2. **Configure Exposure**:
   - **REST API (`@shukoi/api`)**:
     - `http: { method, path, successStatus, customContentType?, requireIdempotencyKey? }`.
     - Query parameters in `action.input` are automatically projected into OpenAPI 3.1 for `GET` and `DELETE` routes.
     - Parameter merging priority strictly guarantees $\text{Query} < \text{JSON Body} < \text{Path}$ (path variables `:id` can never be overridden).
     - Multi-value query parameters (e.g. `?tags=a&tags=b`) map cleanly into `Type.Array()`.
     - Non-JSON payloads (CSV, SVG, text) configure `customContentType: 'text/csv'`.
   - **Model Context Protocol (`@shukoi/mcp`)**:
     - **Tool:** `mcp: { enabled: true, entityType: 'tool', annotations?: { readOnlyHint?, destructiveHint?, idempotentHint?, openWorldHint? } }`.
     - **Resource:** `mcp: { enabled: true, entityType: 'resource', resourceUriTemplate?: 'cluster://{id}/metrics', mimeType?: 'application/json' }` (defaults to `resource://${action.name}` if template is omitted).
     - **Prompt:** `mcp: { enabled: true, entityType: 'prompt' }` (arguments schema and descriptions are automatically compiled from `action.input`).
3. **Implement Pure Handler**:
   - Check `ctx.signal.aborted` or call `ctx.signal.throwIfAborted?.()` before expensive operations.
   - Throw `new DomainError(code, message, httpStatus)` for operational errors (automatically mapped to RFC 9457 `problem+json` on REST and `{ isError: true }` on MCP).
   - Register deterministic resource teardowns via `ctx.onFinally(() => cleanup())`.
4. **Accessing Platform-Specific Resources Cleanly**:
   - To access Cloudflare bindings (D1, KV, R2) and post-response tasks without manual casting:
     ```typescript
     import { getCloudflareContext } from '@shukoi/cloudflare';
     const { env, waitUntil } = getCloudflareContext<MyEnv>(ctx);
     ```
   - To access AWS Lambda metadata (AWS Request ID, remaining time, function ARN):
     ```typescript
     import { getLambdaContext } from '@shukoi/lambda';
     const { context, getRemainingTimeInMillis } = getLambdaContext(ctx);
     ```
   - To access self-hosted container metadata (client IP, port, server health state):
     ```typescript
     import { getSelfHostContext } from '@shukoi/selfhost';
     const { remoteAddress, serverState } = getSelfHostContext(ctx);
     ```
5. **Register & Verify**: Export the action in `src/actions/index.ts` and author a tri-transport parity test (`QG-01`) in `test/actions/<domain>-<verb>.test.ts`.

For the complete list of `DomainError` codes and status mappings, read [references/error-codes.md](references/error-codes.md).
To copy a pre-configured template, read [assets/action.template.ts](assets/action.template.ts).
