# @shukoi/mcp Package Constitution

## Local Scope & Boundaries

`@shukoi/mcp` implements Protocol Module B with two subpaths:

- `./http`: Streamable HTTP MCP transport for cloud and serverless deployments.
- `./stdio`: Local process STDIO MCP transport for desktop and local AI agents.

### Invariants & Non-Negotiable Rules

1. **Subpath Isolation:**
   - `./http` must contain ZERO `node:*` imports.
   - `./stdio` is permitted to import `node:readline`, `node:process`, etc.
2. **Per-Connection Scoped Servers:** In `./http`, never create a global singleton `Server`. Every incoming HTTP request must instantiate an isolated scoped server via `createScopedMcpServer` and close it in `finally`.
3. **DNS-Rebinding Protection:** `./http` must validate `Host` against `allowedHosts` and `Origin` against `allowedOrigins`, rejecting mismatches with HTTP 403.
4. **Strict `stdout` Sterility:** In `./stdio`, `console.*` methods must be hijacked to `stderr`. Only JSON-RPC 2.0 frames may write to `stdout`.
5. **Backpressure Drain Handling:** Outbound frames to `stdout` must await the `drain` event if the kernel buffer returns `false`.
6. **Anti-Zombie Termination:** In `./stdio`, `setupZombieWatchdog` must monitor `stdin` closure and exit cleanly with code 0 within 200 ms.
