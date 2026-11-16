/**
 * @purpose CLI project scaffolder engine for Shukoi applications (create-shukoi).
 * @rationale Bootstraps contract-first, modular micro-framework projects with strict dependency pruning according to user-selected products and deployment targets.
 * @preconditions Node.js 22+ or Bun 1.2+ runtime environment.
 * @invariants Strict dependency pruning; zero unneeded packages; fail-fast validation.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';

export type ShukoiProduct = 'api' | 'mcp-http' | 'mcp-stdio';
export type ShukoiTarget = 'cloudflare' | 'lambda' | 'selfhost';
export type PackageManager = 'pnpm' | 'npm' | 'bun';

/**
 * @purpose Configuration options for scaffolding a new Shukoi project.
 * @rationale Encapsulates target directory, selected protocol modules, deployment targets, and package manager.
 * @invariants Readonly options structure.
 */
export interface ScaffoldOptions {
  readonly projectName: string;
  readonly targetDir: string;
  readonly products: readonly ShukoiProduct[];
  readonly targets: readonly ShukoiTarget[];
  readonly packageManager: PackageManager;
  readonly includeLinter?: boolean | undefined;
}

/**
 * @purpose Parses command-line arguments into structured scaffold options for non-interactive CI automation.
 * @rationale Enables automated test pipelines and container scaffolding without interactive terminal prompts.
 * @param argv Command line argument array (process.argv.slice(2)).
 * @returns Partial scaffold options extracted from flags.
 * @throws Never throws.
 * @invariants Big-O O(n) where n is arg count.
 */
export function parseCliArgs(argv: readonly string[]): Partial<ScaffoldOptions> {
  const result: {
    projectName?: string;
    targetDir?: string;
    products?: ShukoiProduct[];
    targets?: ShukoiTarget[];
    packageManager?: PackageManager;
    includeLinter?: boolean;
  } = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) {
      continue;
    }

    if (arg === '--no-linter') {
      result.includeLinter = false;
    } else if (arg === '--products' && argv[i + 1]) {
      const items = argv[i + 1]?.split(',').map((s) => s.trim()) as ShukoiProduct[];
      result.products = items;
      i++;
    } else if (arg.startsWith('--products=')) {
      result.products = arg
        .slice(11)
        .split(',')
        .map((s) => s.trim()) as ShukoiProduct[];
    } else if (arg === '--targets' && argv[i + 1]) {
      const items = argv[i + 1]?.split(',').map((s) => s.trim()) as ShukoiTarget[];
      result.targets = items;
      i++;
    } else if (arg.startsWith('--targets=')) {
      result.targets = arg
        .slice(10)
        .split(',')
        .map((s) => s.trim()) as ShukoiTarget[];
    } else if (arg === '--pm' && argv[i + 1]) {
      result.packageManager = argv[i + 1]?.trim() as PackageManager;
      i++;
    } else if (arg.startsWith('--pm=')) {
      result.packageManager = arg.slice(5).trim() as PackageManager;
    } else if (!arg.startsWith('-') && !result.projectName) {
      result.projectName = arg;
    }
  }

  return result;
}

/**
 * @purpose Scaffolds a complete Shukoi project on disk according to configuration options.
 * @rationale Emits pruned package.json, TypeScript configs, sample declarative action, target entrypoints, and test suites.
 * @preconditions options must specify projectName, targetDir, products, targets, and packageManager.
 * @param options ScaffoldOptions defining generation parameters.
 * @returns Object listing target directory and generated files.
 * @throws Error if filesystem write fails.
 * @invariants Strictly prunes dependencies to selected targets; zero unnecessary packages.
 */
export async function scaffoldProject(
  options: ScaffoldOptions,
): Promise<{ projectDir: string; filesCreated: readonly string[] }> {
  const projectDir = path.resolve(options.targetDir, options.projectName);
  await fs.mkdir(projectDir, { recursive: true });

  const filesCreated: string[] = [];

  async function writeFile(relPath: string, content: string): Promise<void> {
    const fullPath = path.join(projectDir, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
    filesCreated.push(relPath);
  }

  // 1. Dependency Pruning in package.json
  const dependencies: Record<string, string> = {
    '@shukoi/core': '^1.0.3',
    '@sinclair/typebox': '^0.34.52',
    jose: '^5.9.6',
  };

  const devDependencies: Record<string, string> = {
    typescript: '^5.7.3',
    vitest: '^3.0.5',
    '@types/node': '^22.13.4',
  };

  if (
    options.products.includes('api') ||
    options.targets.includes('cloudflare') ||
    options.targets.includes('lambda') ||
    options.targets.includes('selfhost')
  ) {
    dependencies['hono'] = '^4.7.0';
  }

  if (options.products.includes('api')) {
    dependencies['@shukoi/api'] = '^1.0.3';
  }

  if (options.products.includes('mcp-http') || options.products.includes('mcp-stdio')) {
    dependencies['@shukoi/mcp'] = '^1.0.3';
    dependencies['@modelcontextprotocol/sdk'] = '^1.32.2';
  }

  if (options.targets.includes('cloudflare')) {
    dependencies['@shukoi/cloudflare'] = '^1.0.3';
    devDependencies['wrangler'] = '^3.114.0';
    devDependencies['@cloudflare/workers-types'] = '^4.20260200.0';
  }

  if (options.targets.includes('lambda')) {
    dependencies['@shukoi/lambda'] = '^1.0.3';
    devDependencies['@types/aws-lambda'] = '^8.10.147';
    devDependencies['esbuild'] = '^0.25.0';
  }

  if (options.targets.includes('selfhost')) {
    dependencies['@shukoi/selfhost'] = '^1.0.3';
  }

  const scripts: Record<string, string> = {
    build: 'tsc',
    test: 'vitest run',
    typecheck: 'tsc --noEmit',
  };

  if (options.targets.includes('cloudflare')) {
    if (options.targets.length === 1) {
      scripts['dev'] = 'wrangler dev';
      scripts['deploy'] = 'wrangler deploy';
    } else {
      scripts['dev:cf'] = 'wrangler dev';
      scripts['deploy:cf'] = 'wrangler deploy';
    }
    scripts['cf-typegen'] = 'wrangler types env.d.ts';
  }

  if (options.targets.includes('lambda')) {
    scripts['build:lambda'] =
      'esbuild src/entries/lambda.ts --bundle --platform=node --target=node22 --format=esm --outfile=dist/lambda.mjs';
    if (options.targets.length === 1) {
      scripts['dev'] = 'sam local start-api';
      scripts['deploy'] = 'sam deploy --guided';
    } else {
      scripts['dev:lambda'] = 'sam local start-api';
      scripts['deploy:lambda'] = 'sam deploy --guided';
    }
  }

  if (options.targets.includes('selfhost')) {
    if (options.targets.length === 1) {
      scripts['dev'] = 'node --watch src/entries/selfhost.ts';
      scripts['start'] = 'node dist/entries/selfhost.js';
    } else {
      scripts['dev:selfhost'] = 'node --watch src/entries/selfhost.ts';
      scripts['start:selfhost'] = 'node dist/entries/selfhost.js';
    }
  }

  if (options.includeLinter !== false) {
    devDependencies['@biomejs/biome'] = '^2.6.7';
    scripts['lint'] = 'biome check .';
    scripts['format'] = 'biome format --write .';
  }

  const pkgJson = {
    name: options.projectName,
    version: '1.0.0',
    type: 'module',
    license: 'MIT',
    scripts,
    dependencies,
    devDependencies,
  };

  await writeFile('package.json', `${JSON.stringify(pkgJson, null, 2)}\n`);

  // .gitignore
  const gitignoreContent = `node_modules/
dist/
coverage/
*.log
.env
.env.*
!.env.example
.DS_Store
`;
  await writeFile('.gitignore', gitignoreContent);

  if (options.includeLinter !== false) {
    const projectBiomeJson = {
      $schema: 'https://biomejs.dev/schemas/2.6.7/schema.json',
      vcs: {
        enabled: true,
        clientKind: 'git',
        useIgnoreFile: true,
      },
      files: {
        ignoreUnknown: true,
        includes: ['src/**', 'test/**', '*.json', '*.ts'],
      },
      formatter: {
        enabled: true,
        indentStyle: 'space',
        indentWidth: 2,
        lineWidth: 100,
      },
      javascript: {
        formatter: {
          quoteStyle: 'single',
        },
      },
      linter: {
        enabled: true,
        rules: {
          preset: 'recommended',
          suspicious: {
            noConsole: 'error',
          },
        },
      },
      overrides: [
        {
          includes: ['test/**'],
          linter: {
            rules: {
              suspicious: {
                noConsole: 'off',
              },
            },
          },
        },
      ],
    };
    await writeFile('biome.json', `${JSON.stringify(projectBiomeJson, null, 2)}\n`);
  }

  // 2. tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: 'ES2023',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      skipLibCheck: true,
      outDir: './dist',
      rootDir: './src',
      ...(options.targets.includes('cloudflare') ? { types: ['@cloudflare/workers-types'] } : {}),
    },
    include: options.targets.includes('cloudflare') ? ['src/**/*', 'env.d.ts'] : ['src/**/*'],
  };
  await writeFile('tsconfig.json', `${JSON.stringify(tsconfig, null, 2)}\n`);

  // 3. src/config.ts
  const configCode = `import { createDefaultConfig, type ShukoiConfig } from '@shukoi/core';

export const config: ShukoiConfig = createDefaultConfig({
  observability: {
    serviceName: '${options.projectName}',
  },
});
`;
  await writeFile('src/config.ts', configCode);

  // 4. Sample Action: src/actions/health.ts
  const healthActionCode = `import { defineAction } from '@shukoi/core';
import { Type } from '@sinclair/typebox';

export const healthAction = defineAction({
  name: 'healthCheck',
  summary: 'Service liveness and readiness probe',
  description: 'Returns health status and timestamp',
  authRequired: false,
  http: {
    method: 'GET',
    path: '/health',
    successStatus: 200,
  },
  mcp: {
    enabled: true,
    entityType: 'tool',
  },
  input: Type.Object({}),
  output: Type.Object({
    status: Type.String(),
    timestamp: Type.String(),
  }),
  async handler(_input, ctx) {
    ctx.logger.info('Health probe executed');
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    };
  },
});
`;
  await writeFile('src/actions/health.ts', healthActionCode);

  // 5. Test Suite: test/health.test.ts
  const healthTestCode = `import { createActionTestHarness } from '@shukoi/core/testing';
import { describe, expect, it } from 'vitest';
import { healthAction } from '../src/actions/health.js';

describe('healthAction', () => {
  it('returns healthy status payload', async () => {
    const harness = createActionTestHarness();
    const result = await harness.execute(healthAction, {});
    expect(result.status).toBe('healthy');
    expect(result.timestamp).toBeDefined();
  });
});
`;
  await writeFile('test/health.test.ts', healthTestCode);

  // 6. Target Entrypoints Generation
  if (options.targets.includes('selfhost')) {
    const selfhostCode = options.products.includes('api')
      ? `import { createRestRouter } from '@shukoi/api';
import { createSelfHostServer } from '@shukoi/selfhost';
import { healthAction } from '../actions/health.js';
import { config } from '../config.js';

const app = createRestRouter([healthAction], config);
export const server = createSelfHostServer(app, config);
`
      : `import { compileMcpCatalog, createMcpHttpHandler } from '@shukoi/mcp/http';
import { createSelfHostServer } from '@shukoi/selfhost';
import { Hono } from 'hono';
import { healthAction } from '../actions/health.js';
import { config } from '../config.js';

const app = new Hono();
const catalog = compileMcpCatalog([healthAction]);
const handler = createMcpHttpHandler(catalog, config);
app.all('/mcp', async (c) => handler(c.req.raw, c.env));
export const server = createSelfHostServer(app, config);
`;
    await writeFile('src/entries/selfhost.ts', selfhostCode);

    const dockerfile = `FROM node:22-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g pnpm
COPY --from=builder /app/package.json /app/pnpm-lock.yaml* ./
COPY --from=builder /app/dist ./dist
RUN pnpm install --prod --frozen-lockfile
USER node
EXPOSE 3000
CMD ["node", "dist/entries/selfhost.js"]
`;
    await writeFile('Dockerfile', dockerfile);

    const dockerignore = `node_modules
dist
.git
.agent
.env
.env.*
coverage
*.log
`;
    await writeFile('.dockerignore', dockerignore);
  }

  if (options.targets.includes('cloudflare')) {
    const cloudflareCode = options.products.includes('api')
      ? `import { createRestRouter } from '@shukoi/api';
import { toCloudflareWorker } from '@shukoi/cloudflare';
import { healthAction } from '../actions/health.js';
import { config } from '../config.js';

const app = createRestRouter([healthAction], config);
export default toCloudflareWorker(app);
`
      : `import { compileMcpCatalog, createMcpHttpHandler } from '@shukoi/mcp/http';
import { toCloudflareWorker } from '@shukoi/cloudflare';
import { Hono } from 'hono';
import { healthAction } from '../actions/health.js';
import { config } from '../config.js';

const app = new Hono();
const catalog = compileMcpCatalog([healthAction]);
const handler = createMcpHttpHandler(catalog, config);
app.all('/mcp', async (c) => handler(c.req.raw, c.env));
export default toCloudflareWorker(app);
`;
    await writeFile('src/entries/cloudflare.ts', cloudflareCode);

    const wranglerConfig = `{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "${options.projectName}",
  "main": "src/entries/cloudflare.ts",
  "compatibility_date": "2026-11-15",
  "compatibility_flags": ["nodejs_compat"],
  "observability": {
    "enabled": true
  }
}
`;
    await writeFile('wrangler.jsonc', wranglerConfig);

    const envDeclaration = `// Cloudflare Workers environment bindings interface.
// Run \`${options.packageManager} run cf-typegen\` after configuring bindings in wrangler.jsonc.
interface Env {
  // KV?: KVNamespace;
  // DB?: D1Database;
  // BUCKET?: R2Bucket;
}
`;
    await writeFile('env.d.ts', envDeclaration);
  }

  if (options.targets.includes('lambda')) {
    const lambdaCode = options.products.includes('api')
      ? `import { createRestRouter } from '@shukoi/api';
import { toLambdaHandler } from '@shukoi/lambda';
import { healthAction } from '../actions/health.js';
import { config } from '../config.js';

const app = createRestRouter([healthAction], config);
export const handler = toLambdaHandler(app, { config });
`
      : `import { compileMcpCatalog, createMcpHttpHandler } from '@shukoi/mcp/http';
import { toLambdaHandler } from '@shukoi/lambda';
import { Hono } from 'hono';
import { healthAction } from '../actions/health.js';
import { config } from '../config.js';

const app = new Hono();
const catalog = compileMcpCatalog([healthAction]);
const mcpHandler = createMcpHttpHandler(catalog, config);
app.all('/mcp', async (c) => mcpHandler(c.req.raw, c.env));
export const handler = toLambdaHandler(app, { config });
`;
    await writeFile('src/entries/lambda.ts', lambdaCode);

    const samTemplate = `AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: ${options.projectName} - Shukoi AWS Lambda Service

Globals:
  Function:
    Timeout: 30
    MemorySize: 512
    Runtime: nodejs22.x
    Architectures:
      - arm64

Resources:
  HttpApiFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: .
      Handler: dist/lambda.mjs.handler
      Events:
        HttpApiCatchAll:
          Type: HttpApi
          Properties:
            Path: /{proxy+}
            Method: ANY
        HttpApiRoot:
          Type: HttpApi
          Properties:
            Path: /
            Method: ANY

Outputs:
  HttpApiUrl:
    Description: HTTP API Gateway endpoint URL
    Value: !Sub "https://\${ServerlessHttpApi}.execute-api.\${AWS::Region}.amazonaws.com"
`;
    await writeFile('template.yaml', samTemplate);
  }

  if (options.products.includes('mcp-http')) {
    const mcpHttpCode = `import { compileMcpCatalog, createMcpHttpHandler } from '@shukoi/mcp/http';
import { healthAction } from '../actions/health.js';
import { config } from '../config.js';

const catalog = compileMcpCatalog([healthAction]);
export const handler = createMcpHttpHandler(catalog, config);
`;
    await writeFile('src/entries/mcp-http.ts', mcpHttpCode);
  }

  if (options.products.includes('mcp-stdio')) {
    const mcpStdioCode = `import { compileMcpCatalog } from '@shukoi/mcp';
import { startStdioServer } from '@shukoi/mcp/stdio';
import { healthAction } from '../actions/health.js';
import { config } from '../config.js';

const catalog = compileMcpCatalog([healthAction]);
export const server = startStdioServer(catalog, config);
`;
    await writeFile('src/entries/mcp-stdio.ts', mcpStdioCode);
  }

  const cfCommands = options.targets.includes('cloudflare')
    ? `- **Dev (Cloudflare):** \`${options.packageManager} run ${options.targets.length === 1 ? 'dev' : 'dev:cf'}\`\n- **Deploy:** \`${options.packageManager} run ${options.targets.length === 1 ? 'deploy' : 'deploy:cf'}\`\n- **Types:** \`${options.packageManager} run cf-typegen\`\n`
    : '';

  const lambdaCommands = options.targets.includes('lambda')
    ? `- **Build (Lambda):** \`${options.packageManager} run build:lambda\`\n- **Dev (Lambda / SAM):** \`${options.packageManager} run ${options.targets.length === 1 ? 'dev' : 'dev:lambda'}\`\n- **Deploy:** \`${options.packageManager} run ${options.targets.length === 1 ? 'deploy' : 'deploy:lambda'}\`\n`
    : '';

  const selfhostCommands = options.targets.includes('selfhost')
    ? `- **Dev (Self-Host):** \`${options.packageManager} run ${options.targets.length === 1 ? 'dev' : 'dev:selfhost'}\`\n- **Start:** \`${options.packageManager} run ${options.targets.length === 1 ? 'start' : 'start:selfhost'}\`\n- **Docker Build:** \`docker build -t ${options.projectName} .\`\n`
    : '';

  // 7. AI Agent Context & Constitutional Files
  const appAgentsMd = `# ${options.projectName} Application Constitution (AGENTS.md)

## 1. Project Overview & Verification Commands
- **Build:** \`${options.packageManager} run build\`
- **Test:** \`${options.packageManager} test\`
- **Typecheck:** \`${options.packageManager} run typecheck\`
${cfCommands}${lambdaCommands}${selfhostCommands}${options.includeLinter !== false ? `- **Lint:** \`${options.packageManager} run lint\`\n- **Format:** \`${options.packageManager} run format\`` : ''}

## 2. Core Architectural Laws for Coding Agents
1. **Zero-Hardcoding:** Read all environment variables through \`src/config.ts\`.
2. **Pure Web-Standard Actions:** Never import \`node:*\` modules inside \`src/actions/*.ts\`.
3. **Strict stdout Sterility:** Never invoke \`console.log\`; use \`ctx.logger.info()\` or \`ctx.logger.error()\`.
4. **Strict Schema Contracts:** Set \`{ additionalProperties: false }\` on all TypeBox objects in \`input\` and \`output\`.
5. **Cancellation & Deadlines:** Always pass \`ctx.signal\` to downstream fetch calls and database queries.

## 3. Skills & Procedural Guidance
- Authoring Actions: read \`skills/shukoi-create-action/SKILL.md\`
- Authoring Quality Gates: read \`skills/shukoi-quality-gates/SKILL.md\`
`;
  await writeFile('AGENTS.md', appAgentsMd);
  await writeFile('CLAUDE.md', '# Claude Code Project Guidelines\n\n@AGENTS.md\n');

  // 7. Bundled Agent Skills (agentskills.io Open Standard)
  const createActionSkill = `---
name: shukoi-create-action
description: Creates or modifies protocol-agnostic business actions using defineAction(), TypeBox schemas, DomainError, and AbortSignal cancellation.
compatibility: TypeScript 5.5+, @sinclair/typebox, @shukoi/core
---

# Authoring Actions in Shukoi

1. Create action in \`src/actions/<name>.ts\` using \`defineAction()\`.
2. Define TypeBox schemas with \`{ additionalProperties: false }\`.
3. Never import \`node:*\` or use \`console.log\`.
4. Throw \`DomainError\` for domain failures.
5. Export action and register route in entrypoint.
`;
  await writeFile('skills/shukoi-create-action/SKILL.md', createActionSkill);

  const qualityGatesSkill = `---
name: shukoi-quality-gates
description: Guides authoring and verifying tri-transport parity tests (QG-01) and boundary tests.
compatibility: TypeScript 5.5+, Vitest 3.x, @shukoi/core
---

# Authoring Tests in Shukoi

1. Use \`createActionTestHarness\` from \`@shukoi/core/testing\`.
2. Assert both successful result transformations and \`DomainError\` failure modes.
3. Test \`AbortSignal\` cancellation and \`ctx.onFinally\` resource teardown.
`;
  await writeFile('skills/shukoi-quality-gates/SKILL.md', qualityGatesSkill);

  return { projectDir, filesCreated };
}

/**
 * @purpose Interactive and automated CLI entrypoint runner.
 * @rationale Guides developers through Clack prompts or consumes automated CI flags.
 * @param argv Command line arguments.
 * @returns Promise resolving when scaffolding completes.
 * @throws Error on unexpected failure.
 * @invariants Exits with code 0 on success.
 */
export async function runCli(argv: readonly string[]): Promise<void> {
  const parsed = parseCliArgs(argv);

  let projectName = parsed.projectName;
  let products = parsed.products;
  let targets = parsed.targets;
  let packageManager = parsed.packageManager;

  // If running in CI or non-interactive mode with all required flags
  if (projectName && products && targets && packageManager) {
    const { projectDir, filesCreated } = await scaffoldProject({
      projectName,
      targetDir: process.cwd(),
      products,
      targets,
      packageManager,
    });
    console.log(pc.green(`✔ Created Shukoi project "${projectName}" at ${projectDir}`));
    console.log(`Generated ${filesCreated.length} files.`);
    return;
  }

  // Interactive mode via @clack/prompts
  p.intro(pc.bgCyan(pc.black(' create-shukoi ')));

  if (!projectName) {
    const nameInput = await p.text({
      message: 'What is your project name?',
      placeholder: 'my-shukoi-service',
      defaultValue: 'my-shukoi-service',
      validate(val) {
        if (!val.trim()) {
          return 'Project name cannot be empty';
        }
        return;
      },
    });
    if (p.isCancel(nameInput)) {
      p.cancel('Scaffolding cancelled');
      process.exit(0);
    }
    projectName = nameInput as string;
  }

  if (!products) {
    const selectedProducts = await p.multiselect({
      message: 'Select protocol interfaces to expose:',
      options: [
        { value: 'api', label: 'REST API + OpenAPI 3.1.0 (@shukoi/api)' },
        { value: 'mcp-http', label: 'MCP Streamable HTTP Server (@shukoi/mcp/http)' },
        { value: 'mcp-stdio', label: 'MCP STDIO Local Server (@shukoi/mcp/stdio)' },
      ],
      initialValues: ['api', 'mcp-http', 'mcp-stdio'],
      required: true,
    });
    if (p.isCancel(selectedProducts)) {
      p.cancel('Scaffolding cancelled');
      process.exit(0);
    }
    products = selectedProducts as ShukoiProduct[];
  }

  if (!targets) {
    const selectedTargets = await p.multiselect({
      message: 'Select deployment runtime targets:',
      options: [
        { value: 'selfhost', label: 'Self-Host (Node.js 22+ / Bun 1.2+ / Docker)' },
        { value: 'cloudflare', label: 'Cloudflare Workers (V8 Isolates)' },
        { value: 'lambda', label: 'AWS Lambda (Node.js ESM)' },
      ],
      initialValues: ['selfhost'],
      required: true,
    });
    if (p.isCancel(selectedTargets)) {
      p.cancel('Scaffolding cancelled');
      process.exit(0);
    }
    targets = selectedTargets as ShukoiTarget[];
  }

  if (!packageManager) {
    const selectedPm = await p.select({
      message: 'Select package manager:',
      options: [
        { value: 'pnpm', label: 'pnpm (recommended)' },
        { value: 'npm', label: 'npm' },
        { value: 'bun', label: 'bun' },
      ],
      initialValue: 'pnpm',
    });
    if (p.isCancel(selectedPm)) {
      p.cancel('Scaffolding cancelled');
      process.exit(0);
    }
    packageManager = selectedPm as PackageManager;
  }

  const spinner = p.spinner();
  spinner.start('Scaffolding Shukoi project...');

  const { filesCreated } = await scaffoldProject({
    projectName,
    targetDir: process.cwd(),
    products,
    targets,
    packageManager,
  });

  spinner.stop(`Scaffolded ${filesCreated.length} files cleanly.`);
  p.outro(
    pc.green(
      `✔ Project "${projectName}" is ready! Run \`cd ${projectName} && ${packageManager} install\``,
    ),
  );
}
