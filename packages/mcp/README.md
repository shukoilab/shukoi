# @shukoi/mcp

> **Protocol Module B: Model Context Protocol (MCP) Streamable HTTP & Sterile STDIO Transports**

[![npm version](https://img.shields.io/npm/v/@shukoi/mcp.svg)](https://www.npmjs.com/package/@shukoi/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`@shukoi/mcp` connects LLM coding agents (such as Claude Desktop, Cursor, OpenCode, and Antigravity IDE) directly to Shukoi actions over the official Model Context Protocol (MCP 2024-11-05 & Streamable HTTP specification). It provides native, specification-pure support for **Tools**, **Resources**, and **Prompts** with dual subpath exports:

1. **`@shukoi/mcp/http`**: Stateless, DNS-rebinding protected Streamable HTTP server for cloud and serverless platforms.
2. **`@shukoi/mcp/stdio`**: Backpressure-safe, anti-zombie STDIO server for local developer workflows.

---

## Core MCP Primitives Supported

Shukoi actions declared with `mcp: { enabled: true, entityType: 'tool' | 'resource' | 'prompt' }` are compiled once at startup into an immutable catalog:

| MCP Primitive | Protocol Methods                                               | Capabilities & Architecture                                                                                                                                                                                                   |
| :------------ | :------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tools**     | `tools/list`, `tools/call`                                     | TypeBox input schemas exported as standard JSON Schema; executes actions with composite cancellation; supports multimodal content blocks (`text`, `image` with Base64, raw strings) and enforces `maxMcpOutputBytes`.         |
| **Resources** | `resources/list`, `resources/templates/list`, `resources/read` | Exposes read-only assets via static URIs (`resource://${name}`) or dynamic RFC 6570 URI templates (e.g. `cluster://{clusterId}/nodes/{nodeId}`). Template parameters are automatically parsed and passed to the action input. |
| **Prompts**   | `prompts/list`, `prompts/get`                                  | Pre-engineered prompt workflows. Argument schemas (`name`, `description`, `required`) are introspected automatically from `action.input`, returning standardized MCP `messages: [{ role, content }]`.                         |

---

## Dual Subpath Architecture

### 1. `@shukoi/mcp/http` (Streamable HTTP)

- **Pure Web Standard (Zero `node:*` Imports):** 100% compatible with Cloudflare Workers V8 isolates, AWS Lambda, and Bun.
- **DNS-Rebinding Defense:** Validates incoming `Host` against `config.security.allowedHosts` and `Origin` against `allowedOrigins`, rejecting mismatches with HTTP 403 Forbidden.
- **Scoped Server Factory (`createScopedMcpServer`):** Eliminates the fatal singleton `_transport` overwrite race condition by instantiating lightweight, isolated server instances per incoming HTTP request (**ADR-002**).
- **Stateless Session Teardown (`DELETE /mcp`):** Responds to HTTP `DELETE` requests with HTTP 204 No Content for clean client session disconnection.
- **Header Negotiation:** Seamlessly negotiates `Accept: application/json, text/event-stream` sent by official MCP clients.
- **Hono Co-Hosting (`mountMcpHttpRoutes`):** Mounts the MCP HTTP handler onto a Hono application instance (e.g. `app.all('/mcp', ...)`), enabling co-hosting REST and MCP on the same port.
- **Output Byte Ceiling (`maxMcpOutputBytes`):** Prevents client OOM crashes by rejecting oversized tool, resource, or prompt payloads with HTTP 413.

### 2. `@shukoi/mcp/stdio` (Local Standard I/O)

- **Strict `stdout` Sterility:** Automatically redirects `console.log`, `info`, `warn`, and `debug` to `process.stderr`, preserving File Descriptor 1 (`process.stdout`) exclusively for clean JSON-RPC 2.0 frames (**ADR-005**).
- **Pure Stdin Readline:** Configures `readline.createInterface` without specifying an output stream, guaranteeing readline internal mechanisms never write control characters to `stdout`.
- **FIFO Outbound Serialization Queue (`enqueueFrameWrite`):** Queues all stdout writes through an asynchronous serialization chain with kernel backpressure drain safety, eliminating frame interleaving between concurrent progress notifications and tool completions.
- **Anti-Zombie Process Watchdog:** Monitors `process.stdin` (`end`, `close`), `process.stdout` (`EPIPE`), and POSIX signals (`SIGINT`, `SIGTERM`), ensuring the child process terminates cleanly (code 0) within 200 ms if the host IDE crashes.
- **Remote Bridge Mode (`bridgeStdioToHttp`):** Relays local STDIO JSON-RPC streams to a remote `@shukoi/mcp/http` cloud endpoint over the network.

---

## Zero External Runtime Dependency Overhead

`@shukoi/mcp` implements the complete Model Context Protocol natively over JSON-RPC 2.0. The official `@modelcontextprotocol/sdk` is declared strictly as an optional peer dependency (`peerDependenciesMeta: { "@modelcontextprotocol/sdk": { "optional": true } }`). Shukoi requires zero external MCP packages at runtime.

---

## Installation

```bash
pnpm add @shukoi/mcp @shukoi/core
# or
npm install @shukoi/mcp @shukoi/core
# or
bun add @shukoi/mcp @shukoi/core
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

### Co-Hosting REST API & MCP HTTP on the Same Hono Server

```typescript
import { createRestRouter } from '@shukoi/api';
import { compileMcpCatalog, mountMcpHttpRoutes } from '@shukoi/mcp/http';
import { createDefaultConfig } from '@shukoi/core';
import { actions } from './actions/index.js';

const config = createDefaultConfig();
const app = createRestRouter(actions, config);
const catalog = compileMcpCatalog(actions);

// Mount MCP HTTP on /mcp
mountMcpHttpRoutes(app, '/mcp', catalog, config);

export default app;
```

### Running over Local STDIO (Claude Desktop / Cursor)

```typescript
import { compileMcpCatalog } from '@shukoi/mcp';
import { startStdioServer } from '@shukoi/mcp/stdio';
import { createDefaultConfig } from '@shukoi/core';
import { myAction } from './actions/myAction.js';

const config = createDefaultConfig();
const catalog = compileMcpCatalog([myAction]);

// Automatically hijacks console to stderr, handles drain backpressure, and listens to stdin
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

## Related Documentation & Architecture

- **System Architecture:** [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) (Deep dive into Protocol Module B, scoped servers, and STDIO sterility).
- **Action Creation Skill:** [skills/shukoi-create-action](../../skills/shukoi-create-action/SKILL.md) (Creating tools, resources, and prompts).
- **Deployment Skill:** [skills/shukoi-deploy-target](../../skills/shukoi-deploy-target/SKILL.md) (Deploying across Cloudflare, Lambda, and Self-Host).

---

## License

MIT © [Shukoi Contributors](https://github.com/shukoilab/shukoi)
