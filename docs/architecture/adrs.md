# Architecture Decision Records (ADRs)

Architecture Decision Records document the key technical choices, trade-offs, and invariants governing the Shukoi framework.

---

## [ADR-001: Adaptive TypeBox JIT Validation Probe](https://github.com/shukoilab/shukoi/blob/main/docs/adr/001-adaptive-typebox-jit.md)
- **Status:** Accepted
- **Context:** Node.js and Bun support JIT code compilation via `new Function()`, enabling TypeBox's ultra-fast `TypeCompiler`. However, Cloudflare Workers V8 isolates strictly forbid dynamic code generation at runtime (`eval`/`Function`), causing crashes if JIT compilers are initialized.
- **Decision:** Probe environment capabilities at startup (`try { new Function(''); return true; } catch { return false; }`). Cache result in `SUPPORTS_JIT`. When `true`, compile schemas with `TypeCompiler.Compile()`. When `false`, safely fall back to AST interpretation (`Value.Check()`).

---

## [ADR-002: Per-Request Scoped MCP Server Factory](https://github.com/shukoilab/shukoi/blob/main/docs/adr/002-per-request-mcp-server.md)
- **Status:** Accepted
- **Context:** The official `@modelcontextprotocol/sdk` maintains a mutable `this._transport` reference on its `Server` singleton instance. Under concurrent HTTP requests, parallel requests overwrite each other's transport state, resulting in dropped frames and race conditions.
- **Decision:** Do not use a singleton server for HTTP. Compile and freeze the MCP catalog once at application boot (`compileMcpCatalog`), and instantiate a lightweight, isolated `createScopedMcpServer` per incoming HTTP connection, closing it deterministically in a `finally` block.

---

## [ADR-003: Single-Flight Mutex for JWKS Key Discovery](https://github.com/shukoilab/shukoi/blob/main/docs/adr/003-single-flight-jwks-discovery.md)
- **Status:** Accepted
- **Context:** When cold starts or traffic spikes hit an edge cluster, hundreds of concurrent requests requiring JWT verification simultaneously query the authorization server's `.well-known/jwks.json` endpoint (cache stampede).
- **Decision:** Implement a Single-Flight Mutex (`inFlightPromise`). If a JWKS fetch is already in flight, all concurrent verifications latch onto the existing promise instead of firing redundant HTTP requests.

---

## [ADR-004: Stream-Bounded Body Parsing (OOM Defense)](https://github.com/shukoilab/shukoi/blob/main/docs/adr/004-stream-bounded-body-parsing.md)
- **Status:** Accepted
- **Context:** Attackers can bypass naive `Content-Length` header checks by sending chunked transfer encoding (`Transfer-Encoding: chunked`), slowly streaming gigabytes of data and crashing the Node/Bun process with an Out-of-Memory (OOM) fatal error.
- **Decision:** Never rely on `Content-Length`. Read incoming request bodies chunk-by-chunk using a `ReadableStreamDefaultReader` with an accumulating byte counter (`readBoundedJsonStream`). Abort the stream with HTTP 413 the instant accumulated bytes exceed `config.limits.maxBodyBytes`.

---

## [ADR-005: Sterile STDOUT & Anti-Zombie Process Watchdog](https://github.com/shukoilab/shukoi/blob/main/docs/adr/005-sterile-stdout-and-anti-zombie.md)
- **Status:** Accepted
- **Context:** In STDIO MCP mode, desktop IDEs communicate with the server over File Descriptor 1 (`process.stdout`). Any unhandled `console.log()` pollutes the JSON-RPC stream and breaks the client. Furthermore, if the parent IDE crashes, headless child processes remain as zombies.
- **Decision:** Hijack `console.log/info/warn/debug` to redirect output exclusively to `process.stderr`. Listen for `stdin` closure, `stdout` `EPIPE`, and POSIX signals to terminate the child process with exit code 0 within 200 ms.
