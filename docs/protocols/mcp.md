# Protocol Module B: Model Context Protocol (MCP)

`@shukoi/mcp` connects LLM agents (Claude Desktop, Cursor, OpenCode, Antigravity IDE) directly to declarative Shukoi actions over the official **Model Context Protocol (MCP 2024-11-05 & Streamable HTTP specification)**.

---

## Core MCP Primitives Supported

Shukoi compiles action schemas into an immutable, frozen catalog supporting all primary MCP primitives natively:

| Primitive | Protocol Methods | Capabilities & Architecture |
| :--- | :--- | :--- |
| **Tools** | `tools/list`, `tools/call` | TypeBox input schemas exported as standard JSON Schema; composite cancellation; supports multimodal content blocks (`text`, `image` with Base64, raw strings) and enforces `maxMcpOutputBytes`. |
| **Resources** | `resources/list`, `resources/templates/list`, `resources/read` | Exposes read-only assets via static URIs (`resource://${name}`) or dynamic RFC 6570 URI templates (e.g. `cluster://{clusterId}/nodes/{nodeId}`). Template parameters are automatically parsed and passed to the action input. |
| **Prompts** | `prompts/list`, `prompts/get` | Pre-engineered prompt workflows. Argument schemas (`name`, `description`, `required`) are introspected automatically from `action.input`, returning standardized MCP `messages: [{ role, content }]`. |

---

## Dual Subpath Architecture

### 1. Streamable HTTP (`@shukoi/mcp/http`)
Designed for edge isolates, serverless containers, and cloud deployments:

- **Pure Web Standard:** Zero `node:*` imports; 100% compatible with Cloudflare Workers isolates, AWS Lambda, and Bun.
- **DNS-Rebinding Defense:** Validates incoming `Host` against `config.security.allowedHosts` and `Origin` against `allowedOrigins`, rejecting mismatches with HTTP 403 Forbidden.
- **Per-Request Scoped Server (ADR-002):** Eliminates the fatal singleton `_transport` overwrite race condition in official SDKs by creating isolated server instances per HTTP request.
- **Stateless Session Teardown (`DELETE /mcp`):** Responds to HTTP `DELETE` requests with HTTP 204 No Content for clean client session disconnection.
- **Header Negotiation:** Seamlessly negotiates `Accept: application/json, text/event-stream` sent by official MCP clients.

### 2. Local Standard I/O (`@shukoi/mcp/stdio`)
Designed for local desktop IDEs and CLI agents:

- **Strict `stdout` Sterility (ADR-005):** Automatically redirects `console.log`, `info`, `warn`, and `debug` to `process.stderr`, preserving File Descriptor 1 (`process.stdout`) exclusively for clean JSON-RPC 2.0 frames.
- **Pure Stdin Readline:** Configures `readline.createInterface` without specifying an output stream, guaranteeing readline internal mechanisms never write control characters to `stdout`.
- **FIFO Outbound Serialization Queue (`enqueueFrameWrite`):** Queues all stdout writes through an asynchronous serialization chain with kernel backpressure drain safety, eliminating frame interleaving between concurrent progress notifications and tool completions.
- **Anti-Zombie Process Watchdog:** Actively listens for `process.stdin` pipe closure, `process.stdout` `EPIPE`, and POSIX signals, aborting active controllers and exiting code 0 within 200 ms if the host IDE disconnects.

---

## Co-Hosting REST API & MCP HTTP on the Same Hono Server

You can author actions once and co-host REST API routes and the Streamable MCP HTTP endpoint on the exact same port:

```typescript
import { createRestRouter } from '@shukoi/api';
import { compileMcpCatalog, mountMcpHttpRoutes } from '@shukoi/mcp/http';
import { createDefaultConfig } from '@shukoi/core';
import { actions } from './actions/index.js';

const config = createDefaultConfig();
const app = createRestRouter(actions, config);
const catalog = compileMcpCatalog(actions);

// Mount MCP Streamable HTTP on /mcp
mountMcpHttpRoutes(app, '/mcp', catalog, config);

export default app;
```

---

## Connecting Claude Desktop & Cursor

To expose your Shukoi actions directly to desktop AI coding assistants, author an entrypoint in `src/entries/mcp-stdio.ts`:

```typescript
import { compileMcpCatalog } from '@shukoi/mcp';
import { startStdioServer } from '@shukoi/mcp/stdio';
import { createDefaultConfig } from '@shukoi/core';
import { actions } from '../actions/index.js';

const config = createDefaultConfig();
const catalog = compileMcpCatalog(actions);

// Start backpressure-safe STDIO server with anti-zombie watchdog
export const server = startStdioServer(catalog, config);
```

### Claude Desktop Configuration (`claude_desktop_config.json`)
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
Restart Claude Desktop, and all your tools, resources, and prompts will be available immediately!
