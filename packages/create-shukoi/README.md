# create-shukoi

> **Interactive & Automated Project Scaffolder CLI for the Shukoi Micro-Framework Ecosystem**

[![npm version](https://img.shields.io/npm/v/create-shukoi.svg)](https://www.npmjs.com/package/create-shukoi)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`create-shukoi` is the official CLI scaffolder for generating contract-first, modular Shukoi services. It features interactive terminal prompts via `@clack/prompts` as well as deterministic command-line flags for CI automation pipelines.

---

## Key Features

- **Strict Dependency Pruning:** Emits package manifests containing only `@shukoi/core` and the exact protocol modules and deployment runtimes selected by the user, avoiding bloated dependencies.
- **Automated AI Agent Context Bundling:** Automatically generates user-level `AGENTS.md`, `CLAUDE.md`, and default skills (`skills/shukoi-create-action/`, `skills/shukoi-quality-gates/`) so your AI assistant immediately understands how to create actions and write tests.
- **Zero-Hardcoding Bootstrap:** Scaffolds a strongly-typed `src/config.ts` using TypeBox, a production-ready sample action (`src/actions/health.ts`), target entrypoints (`src/entries/`), and pre-configured Vitest test suites.
- **Automated CI/Non-Interactive Mode:** Supports full parameterization via CLI flags for scripts and containerized scaffolding.

---

## Installation & Usage

### Interactive Mode

```bash
npm create shukoi@latest my-service
# or
pnpm create shukoi@latest my-service
# or
bun create shukoi@latest my-service
```

### Non-Interactive CI Automation Mode

```bash
npm create shukoi@latest my-service -- \
  --products api,mcp-http,mcp-stdio \
  --targets cloudflare,lambda,selfhost \
  --pm pnpm
```

---

## Command-Line Flags

| Flag             | Valid Values                       | Default                  | Description                                           |
| :--------------- | :--------------------------------- | :----------------------- | :---------------------------------------------------- |
| `[project-name]` | String                             | Interactive prompt       | Name and directory of the project to create           |
| `--products`     | `api`, `mcp-http`, `mcp-stdio`     | `api,mcp-http,mcp-stdio` | Comma-separated list of protocol interfaces to expose |
| `--targets`      | `cloudflare`, `lambda`, `selfhost` | `selfhost`               | Comma-separated list of deployment runtimes to target |
| `--pm`           | `pnpm`, `npm`, `bun`               | `pnpm`                   | Preferred package manager for lockfile generation     |
| `--no-linter`    | Flag                               | `false`                  | Skips `@biomejs/biome` and `biome.json` scaffolding   |

---

## Generated Project Directory Structure

```text
my-service/
├── AGENTS.md                   # AI Agent repository constitution for your project
├── CLAUDE.md                   # Claude Code CLI pointer (@AGENTS.md)
├── biome.json                  # Static analysis & formatting rules
├── package.json                # Pruned package manifest
├── tsconfig.json               # Strict TypeScript configuration
├── skills/                     # Open standard Agent Skills (agentskills.io)
│   ├── shukoi-create-action/   # Skill teaching AI how to author 1-file actions
│   └── shukoi-quality-gates/   # Skill teaching AI how to write unit tests
├── src/
│   ├── config.ts               # Zero-hardcoding TypeBox environment validator
│   ├── actions/
│   │   └── health.ts           # Sample action with TypeBox contract
│   └── entries/                # Generated entrypoints matching selected targets
│       ├── cloudflare.ts       # Cloudflare Workers export (if selected)
│       ├── lambda.ts           # AWS Lambda handler (if selected)
│       └── selfhost.ts         # Bun/Node server (if selected)
└── test/
    └── health.test.ts          # Vitest test suite using createActionTestHarness
```

---

## License

MIT © [Shukoi Contributors](https://github.com/shukoilab/shukoi)
