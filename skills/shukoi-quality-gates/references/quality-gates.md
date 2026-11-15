# Shukoi Quality Gates Reference (QG-01 to QG-07)

## Gate Definitions & Pass Criteria

### QG-01: Tri-Transport Parity Test
- **Objective:** Ensure single-file `defineAction` business logic behaves identically across direct execution, REST, and MCP.
- **Assertion:**
  ```typescript
  expect(directResult).toEqual(expected);
  expect(restResult).toEqual(expected);
  expect(mcpResult).toEqual(expected);
  ```

### QG-02: Isolate Fallback Equivalence Test
- **Objective:** Guard Cloudflare Workers against schema evaluation drift.
- **Assertion:** Compare `compileSchemaValidator(schema, false)` (JIT) vs `compileSchemaValidator(schema, true)` (AST). Both must return identical boolean checks and error paths.

### QG-03: Concurrent Stateless MCP Race Test
- **Objective:** Eliminate `_transport` singleton overwrite bugs under high HTTP concurrency.
- **Assertion:** Fire 200 concurrent requests with random latencies (0..30ms). Every client must receive its own authorization token and clientId.

### QG-04: Chunked Stream OOM Defense Test
- **Objective:** Prevent unauthenticated DoS via chunked stream flooding.
- **Assertion:** Stream chunks totaling 10MB into a server configured with 50KB limit. Verify reader is cancelled and error code is `PAYLOAD_TOO_LARGE` (413).

### QG-05: STDIO stdout Sterility & Drain Test
- **Objective:** Preserve JSON-RPC framing on stdout in STDIO mode.
- **Assertion:** Spawn child process running `hijackConsoleToStderr()`. Call `console.log()` repeatedly and send 512KB payload. Verify stdout lines parse cleanly with `JSON.parse()`.

### QG-06: Zero Memory Leak Soak Test
- **Objective:** Verify absence of unbounded listener or memory leaks over long lifecycles.
- **Assertion:** Execute 10,000 iterations with 2,000 mid-flight `AbortController.abort()` calls. Verify `idempotencyStore.size <= maxEntries` and heap drift is bounded.

### QG-07: Anti-Zombie Process Kill Test
- **Objective:** Ensure STDIO process terminates when host IDE crashes.
- **Assertion:** Spawn child running `setupZombieWatchdog`. Destroy `child.stdin`. Process must exit with code 0 within 200 ms.
