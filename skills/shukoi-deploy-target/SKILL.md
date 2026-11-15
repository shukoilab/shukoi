---
name: shukoi-deploy-target
description: Configures, builds, and deploys Shukoi applications to Cloudflare Workers (V8 Isolates), AWS Lambda (Node.js ESM), or Bun/Node self-hosted containers. Use whenever setting up entrypoints, serverless adapters, or graceful shutdown lifecycles.
compatibility: TypeScript 5.5+, Hono, @shukoi/core
---

# Deploying a Shukoi Application Across Target Runtimes

## Overview
Shukoi applications compile once into a standard Hono REST router and an MCP server catalog. Deployment to specific clouds is achieved simply by wrapping the Hono instance in a runtime adapter:

1. **Cloudflare Workers (`@shukoi/cloudflare`)**:
   ```typescript
   import { createRestRouter } from '@shukoi/api';
   import { toCloudflareWorker } from '@shukoi/cloudflare';
   import { actions } from './actions/index.js';
   import { config } from './config.js';

   const app = createRestRouter(actions, config);
   export default toCloudflareWorker(app);
   ```

2. **AWS Lambda (`@shukoi/lambda`)**:
   ```typescript
   import { createRestRouter } from '@shukoi/api';
   import { toLambdaHandler } from '@shukoi/lambda';
   import { actions } from './actions/index.js';
   import { config } from './config.js';

   const app = createRestRouter(actions, config);
   export const handler = toLambdaHandler(app, { config });
   ```

3. **Self-Host Server (`@shukoi/selfhost`)**:
   ```typescript
   import { createRestRouter } from '@shukoi/api';
   import { createSelfHostServer } from '@shukoi/selfhost';
   import { actions } from './actions/index.js';
   import { config } from './config.js';

   const app = createRestRouter(actions, config);
   export const server = createSelfHostServer(app, config, {
     port: Number(process.env.PORT ?? 3000),
     onShutdown: async () => {
       // Close DB pools
     },
   });
   ```

For runtime capabilities, limits, and configuration details, read [references/runtime-matrix.md](references/runtime-matrix.md).
