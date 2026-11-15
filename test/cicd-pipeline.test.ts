/**
 * @purpose Automated test suite for CI/CD pipeline integrity, publint audits, attw checks, and release configuration.
 * @rationale Verifies export maps, subpath typing, browser bundle sterility, Changesets configuration, and GitHub Action pinning.
 * @preconditions Monorepo packages built and available.
 * @param None
 * @returns Test suite passing with exit code 0.
 * @throws Never throws unhandled; asserts test expectations.
 * @invariants Pure verification tests; zero mutations to repository state.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { syncCliTemplateVersions } from '../scripts/sync-cli-template-versions.mjs';

describe('CI/CD & Release Pipeline Integrity', () => {
  it('verifies that all 3 workflow YAML files exist and use 40-character commit SHA pinning', async () => {
    const workflowDir = path.resolve('.github', 'workflows');
    const files = ['ci.yml', 'deps-weekly.yml', 'release.yml'];

    for (const file of files) {
      const content = await fs.readFile(path.join(workflowDir, file), 'utf-8');
      expect(content).toContain('name:');

      // Find all `uses: ...@<ref>`
      const usesLines = content
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('uses:'));

      for (const line of usesLines) {
        const atIdx = line.indexOf('@');
        expect(atIdx).toBeGreaterThan(0);
        const ref = line.slice(atIdx + 1).split(' ')[0];
        // Must be a 40-character full git commit SHA (immutable action pinning)
        expect(ref?.length).toBe(40);
        if (ref) {
          expect(/^[a-f0-9]{40}$/.test(ref)).toBe(true);
        }
      }
    }
  });

  it('validates .changeset/config.json structure and fixed package synchronization', async () => {
    const configPath = path.resolve('.changeset', 'config.json');
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);

    expect(config.access).toBe('public');
    expect(config.baseBranch).toBe('main');
    expect(Array.isArray(config.fixed)).toBe(true);

    const fixedPackages = config.fixed[0] as string[];
    expect(fixedPackages).toContain('@shukoi/core');
    expect(fixedPackages).toContain('@shukoi/api');
    expect(fixedPackages).toContain('@shukoi/mcp');
    expect(fixedPackages).toContain('@shukoi/cloudflare');
    expect(fixedPackages).toContain('@shukoi/lambda');
    expect(fixedPackages).toContain('@shukoi/selfhost');
    expect(fixedPackages).toContain('create-shukoi');
  });

  it('verifies sync-cli-template-versions.mjs runs cleanly and updates version', async () => {
    const version = await syncCliTemplateVersions();
    expect(version).toBeDefined();

    const cliIndexPath = path.resolve('packages', 'create-shukoi', 'src', 'index.ts');
    const cliContent = await fs.readFile(cliIndexPath, 'utf-8');
    expect(cliContent).toContain(`'@shukoi/core': '^${version}'`);
  });

  it('runs publint across core packages without errors', () => {
    const output = execSync(
      'pnpm dlx publint packages/core packages/api packages/mcp packages/cloudflare packages/lambda packages/selfhost',
      { encoding: 'utf-8', cwd: process.cwd() },
    );
    expect(output).not.toContain('Errors:');
  });

  it('runs @arethetypeswrong/cli across @shukoi/core and @shukoi/mcp with clean ESM profile', () => {
    const coreOutput = execSync(
      'pnpm dlx @arethetypeswrong/cli --pack packages/core --profile esm-only',
      { encoding: 'utf-8', cwd: process.cwd() },
    );
    expect(coreOutput).toContain('node16 (from ESM)');

    const mcpOutput = execSync(
      'pnpm dlx @arethetypeswrong/cli --pack packages/mcp --profile esm-only',
      { encoding: 'utf-8', cwd: process.cwd() },
    );
    expect(mcpOutput).toContain('node16 (from ESM)');
  });

  it('runs esbuild browser bundling dry-run verifying zero node:* leakage on edge packages', () => {
    const output = execSync(
      'pnpm dlx esbuild packages/core/dist/index.js packages/api/dist/index.js packages/mcp/dist/http.js packages/cloudflare/dist/index.js --bundle --platform=browser --format=esm --outdir=/tmp/test-edge-audit --external:hono --external:@sinclair/typebox --external:@modelcontextprotocol/sdk 2>&1',
      { encoding: 'utf-8', cwd: process.cwd() },
    );
    expect(output).toContain('Done');
  });
});
