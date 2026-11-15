# ADR 002: Per-Connection Scoped MCP Server Factory vs Singleton Server

## Status
Accepted

## Context
The official `@modelcontextprotocol/sdk` `Server` class maintains an internal single mutable reference to its active transport:
```typescript
this._transport = transport;
```
If an HTTP server instantiates a single global `Server` instance and multiple concurrent HTTP clients send `POST /mcp` requests, each incoming request attempts to connect its own HTTP transport to the singleton server. This results in a critical transport overwrite race condition, leading to cross-request context bleeding or severed SSE/JSON-RPC connections.

## Decision
In `@shukoi/mcp/src/shared.ts` and `@shukoi/mcp/src/http.ts`:
1. Compile and freeze the tool, resource, and prompt catalog once at application boot (`compileMcpCatalog`).
2. On every incoming HTTP request or STDIO session, call `createScopedMcpServer(catalog, options)`.
3. The scoped server binds only to the specific request's `headers`, `platform`, and `requestSignal`.
4. In a deterministic `finally` block, invoke `await scopedServer.close()` to cleanly abort in-flight operations.

## Consequences for AI Agents
**DO NOT REFACTOR `createScopedMcpServer` INTO A SINGLETON.**
- AI agents must never create a global `const mcpServer = createScopedMcpServer(...)` outside the HTTP request handler.
- Every HTTP invocation must execute on its own scoped server instance.
- Tested and enforced by CI Quality Gate `QG-03` (`test/qg-03-mcp-race.test.ts`), which fires 200 concurrent requests with distinct authentication tokens.
