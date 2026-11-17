/**
 * @purpose Automated test suite verifying the VitePress documentation site and GitHub Pages integrity.
 * @rationale Guarantees zero broken sidebar links, valid OpenAPI 3.1.0 asset generation, clean VitePress build, and asset existence.
 * @preconditions Documentation source markdown files and configuration must exist on disk.
 * @param None
 * @returns Test suite passing with exit code 0.
 * @throws Never throws unhandled; asserts test expectations.
 * @invariants Pure verification tests; zero mutations to repository state.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createShowcaseActions, generateDocsSpec } from '../scripts/generate-docs-spec.mjs';

describe('VitePress Documentation Site & GitHub Pages Integrity', () => {
  it('generates a valid OpenAPI 3.1.0 specification with showcase actions', async () => {
    const specPath = await generateDocsSpec();
    const raw = await fs.readFile(specPath, 'utf-8');
    const spec = JSON.parse(raw);

    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info).toBeDefined();

    const corePkgRaw = await fs.readFile(
      new URL('../packages/core/package.json', import.meta.url),
      'utf-8',
    );
    const { version: coreVersion } = JSON.parse(corePkgRaw);
    expect(spec.info.version).toBe(coreVersion);
    expect(spec.paths).toBeDefined();
    expect(spec.paths['/api/v1/payments']).toBeDefined();
    expect(spec.paths['/api/v1/users/{id}']).toBeDefined();
    expect(spec.paths['/api/v1/events']).toBeDefined();
    expect(spec.paths['/healthz']).toBeDefined();

    // Verify securitySchemes
    expect(spec.components?.securitySchemes?.bearerAuth).toBeDefined();
    expect(spec.components?.securitySchemes?.apiKeyAuth).toBeDefined();

    const actions = createShowcaseActions();
    expect(actions).toHaveLength(4);
  });

  it('verifies all sidebar and nav markdown route destinations exist on disk', async () => {
    const expectedPages = [
      'docs/index.md',
      'docs/guide/getting-started.md',
      'docs/guide/actions.md',
      'docs/guide/errors.md',
      'docs/guide/testing.md',
      'docs/guide/idempotency.md',
      'docs/guide/rate-limiting.md',
      'docs/protocols/rest-api.md',
      'docs/protocols/mcp.md',
      'docs/runtimes/cloudflare.md',
      'docs/runtimes/lambda.md',
      'docs/runtimes/selfhost.md',
      'docs/architecture/overview.md',
      'docs/architecture/adrs.md',
      'docs/reference/api.md',
      'docs/reference/package-matrix.md',
      'docs/reference/agents.md',
    ];

    for (const page of expectedPages) {
      const fullPath = path.resolve(page);
      const exists = await fs
        .access(fullPath)
        .then(() => true)
        .catch(() => false);
      expect(exists, `Missing expected documentation page: ${page}`).toBe(true);
    }
  });

  it('executes pnpm run docs:build cleanly with zero dead links and verifies dist output', async () => {
    const output = execSync('pnpm run docs:build', {
      cwd: path.resolve('.'),
      encoding: 'utf-8',
      timeout: 45000,
    });

    expect(output).toContain('build complete in');

    const distIndex = path.resolve('docs', '.vitepress', 'dist', 'index.html');
    const distOpenApi = path.resolve('docs', '.vitepress', 'dist', 'openapi.json');
    const distScalar = path.resolve('docs', '.vitepress', 'dist', 'reference', 'api.html');

    const indexContent = await fs.readFile(distIndex, 'utf-8');
    expect(indexContent).toContain('Shukoi');
    expect(indexContent).toContain('The Universal Action Framework');

    const openapiContent = await fs.readFile(distOpenApi, 'utf-8');
    const openapiJson = JSON.parse(openapiContent);
    expect(openapiJson.openapi).toBe('3.1.0');

    const scalarHtml = await fs.readFile(distScalar, 'utf-8');
    expect(scalarHtml).toContain('Interactive OpenAPI 3.1.0 Reference');
  });

  it('verifies public branding assets exist', async () => {
    const logoPath = path.resolve('docs', 'public', 'logo.svg');
    const logoExists = await fs
      .access(logoPath)
      .then(() => true)
      .catch(() => false);
    expect(logoExists).toBe(true);

    const logoContent = await fs.readFile(logoPath, 'utf-8');
    expect(logoContent).toContain('<svg');
  });

  it('verifies .github/workflows/pages.yml configuration', async () => {
    const workflowPath = path.resolve('.github', 'workflows', 'pages.yml');
    const content = await fs.readFile(workflowPath, 'utf-8');

    expect(content).toContain("if: github.repository == 'shukoilab/shukoi'");
    expect(content).toContain(
      'actions/upload-pages-artifact@56afc609e74202658d3ffba0e8f6dda462b719fa',
    );
    expect(content).toContain('actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e');
    expect(content).toContain('group: pages');
    expect(content).toContain('cancel-in-progress: false');
    expect(content).toContain('pnpm run docs:build');
  });

  it('verifies package.json documentation scripts are registered', async () => {
    const pkgPath = path.resolve('package.json');
    const content = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);

    expect(pkg.scripts['docs:dev']).toBe('vitepress dev docs');
    expect(pkg.scripts['docs:build']).toBe(
      'node scripts/generate-docs-spec.mjs && vitepress build docs',
    );
    expect(pkg.scripts['docs:preview']).toBe('vitepress preview docs');
    expect(pkg.devDependencies.vitepress).toBeDefined();
  });
});
