# @shukoi/mcp

> **Protocol Module B: Model Context Protocol (MCP) Streamable HTTP & Sterile STDIO Transports**

[![npm version](https://img.shields.io/npm/v/@shukoi/mcp.svg)](https://www.npmjs.com/package/@shukoi/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`@shukoi/mcp` connects LLM coding agents (such as Claude Desktop, Cursor, OpenCode, and Antigravity IDE) directly to Shukoi actions over the official Model Context Protocol (MCP) specification. It features dual subpath exports:

1. **`@shukoi/mcp/http`**: Stateless, DNS-rebinding protected Streamable HTTP server for cloud and serverless platforms.
2. **`@shukoi/mcp/stdio`**: Backpressure-safe, anti-zombie STDIO server for local developer workflows.

---

## Dual Subpath Architecture

### 1. `@shukoi/mcp/http` (Streamable HTTP)

- **Zero `node:*` Imports:** Pure web-standard implementation compatible with Cloudflare Workers isolates, AWS Lambda, and Bun.
- **DNS-Rebinding Defense:** Validates incoming `Host` against `config.security.allowedHosts` and `Origin` against `allowedOrigins`, rejecting mismatches with HTTP 403 Forbidden.
- **Scoped Server Factory (`createScopedMcpServer`):** Avoids the fatal singleton `_transport` overwrite race condition by compiling the action catalog once at boot and instantiating lightweight connection-scoped server instances per HTTP request.
- **Output Byte Ceiling (`maxMcpOutputBytes`):** Prevents client OOM crashes by rejecting payloads exceeding configured thresholds with a structured error.

### 2. `@shukoi/mcp/stdio` (Local Standard I/O)

- **Strict `stdout` Sterility:** Automatically hijacks `console.log`, `info`, `warn`, and `debug` to redirect all text to `process.stderr`, preserving File Descriptor 1 (`process.stdout`) exclusively for clean JSON-RPC 2.0 frames.
- **Backpressure Drain Safety:** Outbound writes to `stdout` await the `drain` event if kernel buffers fill, preventing unbounded memory bloat.
- **Anti-Zombie Process Watchdog:** Monitors `process.stdin` (`end`, `close`) and OS signals (`SIGINT`, `SIGTERM`), ensuring the child process terminates cleanly (code 0) within 200 ms if the host IDE crashes.
- **Remote Bridge Mode (`bridgeStdioToHttp`):** Relays local STDIO JSON-RPC streams to a remote `@shukoi/mcp/http` endpoint over the network.

---

## Installation

```bash
pnpm add @shukoi/mcp @shukoi/core @modelcontextprotocol/sdk
# or
npm install @shukoi/mcp @shukoi/core @modelcontextprotocol/sdk
# or
bun add @shukoi/mcp @shukoi/core @modelcontextprotocol/sdk
```

---

## Usage Examples

### Running over HTTP (Cloudflare, Bun, Node)

```typescript
import { compileMcpCatalog, createMcpHttpHandler } from '@shukoi/mcp/http';
import { createDefaultConfig } from '@shukoi/core';
import { myAction } from './actions/myAction.js';

const config = createDefaultConfig({
  security: { allowedHosts: ['localhost'] },
});

const catalog = compileMcpCatalog([myAction]);
export const mcpHandler = createMcpHttpHandler(catalog, config);

// In standard Web Fetch: export default { fetch: (req) => mcpHandler(req) };
```

### Running over Local STDIO (Claude Desktop / Cursor)

```typescript
import { compileMcpCatalog } from '@shukoi/mcp';
import { startStdioServer } from '@shukoi/mcp/stdio';
import { createDefaultConfig } from '@shukoi/core';
import { myAction } from './actions/myAction.js';

const config = createDefaultConfig();
const catalog = compileMcpCatalog([myAction]);

// Automatically hijacks console to stderr and listens to stdin
export const server = startStdioServer(catalog, config);
```

---

## Connecting Claude Desktop or Cursor (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "my-shukoi-service": {
      "command": "node",
      "args": ["dist/entries/mcp-stdio.js"]
    }
  }
}
```

---

## License

MIT © [Shukoi Contributors](https://github.com/shukoilab/shukoi)
