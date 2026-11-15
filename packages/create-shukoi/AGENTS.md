# create-shukoi Package Constitution

## Local Scope & Boundaries

`create-shukoi` is the interactive terminal and CI automation project scaffolder CLI.

### Invariants & Non-Negotiable Rules

1. **Strict Dependency Pruning:** Emits package manifests containing only `@shukoi/core` and the exact protocol modules and deployment runtime targets selected by the user.
2. **Zero-Hardcoding Configuration:** Generates a strongly-typed `src/config.ts` using TypeBox.
3. **AI Context Bundling:** Automatically scaffolds user-level `AGENTS.md`, `CLAUDE.md`, and default skills into generated projects.
4. **CI Mode Support:** Supports non-interactive flags (`--products`, `--targets`, `--pm`, `--no-linter`).
