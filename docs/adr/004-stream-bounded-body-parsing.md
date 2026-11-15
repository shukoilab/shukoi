# ADR 004: Stream-Bounded Body Parsing & Defense Against Chunked OOM Attacks

## Status
Accepted

## Context
Standard HTTP body parsers frequently inspect the `Content-Length` header to reject payloads larger than a configured maximum. However, HTTP clients using `Transfer-Encoding: chunked` do not emit a `Content-Length` header. Malicious clients can stream gigabytes of continuous data in small chunk increments, causing the server to buffer chunks into memory until the Node.js/Bun process runs out of memory (OOM Crash DoS).

## Decision
In `@shukoi/api/src/stream.ts`, implement `readBoundedJsonStream`:
1. Read incoming requests via `stream.getReader()`.
2. Accumulate incoming chunks while maintaining a strict running counter: `totalBytes += value.byteLength`.
3. If `totalBytes > maxBytes`:
   - Immediately invoke `await reader.cancel('PAYLOAD_TOO_LARGE')` to instruct the underlying network socket to cease streaming.
   - Throw `DomainError('PAYLOAD_TOO_LARGE', ..., 413)`.
4. In `finally`, invoke `reader.releaseLock()`.

## Consequences for AI Agents
**DO NOT REPLACE STREAM CHUNK READING WITH `c.req.json()`.**
- Never bypass `readBoundedJsonStream` by calling `c.req.json()` or `await req.text()` in mutating routes.
- Parameter merge priority must always preserve: `Query Params < JSON Body < Path Params` (path parameters `:id` can never be overwritten by body or query parameters).
- Tested and enforced by CI Quality Gate `QG-04` (`test/qg-04-stream-oom.test.ts`).
