# ADR 005: File Descriptor 1 Sterility & Anti-Zombie STDIO Process Termination

## Status
Accepted

## Context
When running in Model Context Protocol (MCP) STDIO mode, communication with host IDEs (such as Claude Desktop, Cursor, or VS Code) takes place exclusively via standard input (`stdin`) and standard output (`stdout`) using newline-delimited JSON-RPC 2.0 frames.
1. If any library or application code invokes `console.log()` or `console.info()`, raw text is emitted to File Descriptor 1 (`process.stdout`), corrupting JSON-RPC framing and crashing the LLM agent client.
2. If the host IDE crashes or closes its communication pipe without sending `SIGTERM`, child STDIO processes frequently linger as orphan zombie processes indefinitely consuming CPU/RAM.

## Decision
In `@shukoi/mcp/src/stdio.ts`:
1. **Console Hijack:** Immediately redirect `console.log`, `console.info`, `console.warn`, and `console.debug` to `process.stderr.write`.
2. **Backpressure-Safe Outbound Frame Writer:** Wrap stdout writes in `writeFrameWithBackpressure`, awaiting the `drain` event if the kernel buffer returns `false`.
3. **Anti-Zombie Watchdog:** Set up `setupZombieWatchdog`:
   - Call `process.stdin.resume()` to ensure stream flowing mode.
   - Listen to `stdin` (`end`, `close`), `stdout` (`EPIPE`, `ERR_STREAM_DESTROYED`), and `SIGINT`/`SIGTERM`.
   - On trigger: abort all active `AbortController` instances, execute registered cleanup hooks, and call `process.exit(0)`.

## Consequences for AI Agents
**DO NOT WRITE TO `process.stdout` OR CALL UNMANAGED `console.log`.**
- All logging must use `ctx.logger` (routed to `stderr`).
- Tested and enforced by CI Quality Gate `QG-05` (stdout sterility) and `QG-07` (anti-zombie exit within 200 ms).
