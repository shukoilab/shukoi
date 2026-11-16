# Getting Started with Shukoi

Welcome to Shukoi. This guide walks you through setting up your first production service using the official project scaffolder and explaining the fundamental design principles.

---

## Prerequisites

Shukoi is built on modern Web Standards and strict TypeScript. Ensure your local environment meets these requirements:

- **Node.js**: `v22.0.0` LTS or later (or **Bun** `v1.2.0`+)
- **Package Manager**: `pnpm` (recommended), `npm`, or `bun`
- **TypeScript**: `5.5+`

---

## Scaffolding a New Service

The fastest way to initialize a Shukoi application is via `create-shukoi`:

::: code-group

```bash [pnpm]
pnpm create shukoi@latest my-shukoi-app
```

```bash [npm]
npm create shukoi@latest my-shukoi-app
```

```bash [bun]
bun create shukoi@latest my-shukoi-app
```

:::

### Non-Interactive CI Mode

For CI/CD scripts and automated pipelines, you can specify options directly via command-line flags:

```bash
pnpm create shukoi my-shukoi-app --target cloudflare --package-manager pnpm
# Available targets: cloudflare | lambda | selfhost | all
```

---

## Directory Structure

A newly scaffolded Shukoi project follows this clean, domain-driven structure:

```text
my-shukoi-app/
├── src/
│   ├── actions/                  # Declarative business actions
│   │   ├── index.ts              # Action catalog aggregator
│   │   ├── healthCheck.ts        # Liveness & readiness probes
│   │   └── processPayment.ts     # Business feature action
│   ├── entries/                  # Deployment target entrypoints
│   │   ├── cloudflare.ts         # Cloudflare Worker export (fetch)
│   │   ├── lambda.ts             # AWS Lambda handler
│   │   ├── selfhost.ts           # Bun / Node HTTP server
│   │   └── mcp-stdio.ts          # Desktop AI Agent STDIO bridge
│   └── config.ts                 # Strongly typed ShukoiConfig
├── test/
│   ├── health.test.ts            # Fast Vitest unit test
│   └── setup.ts
├── Dockerfile                    # Multi-stage hardened alpine build
├── wrangler.jsonc                # Cloudflare Workers configuration
├── biome.json                    # Static analysis & formatting rules
└── package.json
```

---

## Running the Application

Navigate into your project directory, install dependencies, and launch the development environment:

```bash
cd my-shukoi-app
pnpm install
```

Depending on your configured runtime target, start the appropriate development server:

::: code-group

```bash [Self-Host (Bun/Node)]
pnpm run dev
# Starts server at http://localhost:3000
```

```bash [Cloudflare Workers]
pnpm run dev:cloudflare
# Starts local Wrangler isolate preview
```

```bash [Local MCP Agent Server]
pnpm run dev:mcp
# Starts STDIO server for Claude Desktop / Cursor
```

:::

---

## Verifying the Tri-Transport Ingress

Once running, your single service exposes three distinct interfaces simultaneously:

### 1. HTTP REST Ingress
Test the action endpoint using standard `curl`:
```bash
curl -X POST http://localhost:3000/api/v1/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: idemp_abc123" \
  -d '{"amount": 2500, "currency": "USD", "customerId": "cus_441"}'
```

### 2. Living OpenAPI 3.1.0 Specification
Visit `/openapi.json` in your browser or fetch it:
```bash
curl http://localhost:3000/openapi.json
```
The spec is automatically generated from your TypeBox schemas, complete with auto-extracted query parameters, validation rules, and security definitions.

### 3. Model Context Protocol (MCP) Streamable HTTP
If co-hosting MCP over HTTP, connect any MCP-compatible AI client to `/mcp`:
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}'
```

---

## Next Steps

Now that your project is running, explore the core concepts:
- [The Action Pattern](/guide/actions) — Learn how to author composable actions.
- [Error Handling](/guide/errors) — Master RFC 9457 Problem Details.
- [Protocol Module A: REST](/protocols/rest-api) — Dive into parameter merge priorities and OOM defense.
- [Protocol Module B: MCP](/protocols/mcp) — Connect Claude Desktop and Cursor.
