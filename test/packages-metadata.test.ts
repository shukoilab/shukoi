/**
 * @purpose Automated test suite verifying open-source licenses, npm metadata, and discoverability keywords across all 7 packages.
 * @rationale Ensures every published @shukoi/* package complies with OSS standards, provides clear attribution, and optimizes SEO on npmjs.com.
 * @preconditions Monorepo packages present on disk with valid manifests.
 * @param None
 * @returns Vitest test suite executing with exit code 0.
 * @throws Never throws unhandled; asserts test expectations.
 * @invariants Pure read-only verification; zero workspace mutations.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Package License & NPM Metadata Integrity', () => {
  const packages = [
    'core',
    'api',
    'mcp',
    'cloudflare',
    'lambda',
    'selfhost',
    'store-redis',
    'ratelimit',
    'otel',
    'auth',
    'db',
    'create-shukoi',
  ];

  it('verifies that every package contains an authentic MIT LICENSE file on disk', async () => {
    for (const pkg of packages) {
      const licensePath = path.resolve('packages', pkg, 'LICENSE');
      const content = await fs.readFile(licensePath, 'utf-8');

      expect(content).toContain('MIT License');
      expect(content).toContain('Copyright (c) 2026 shukoilab');
    }
  });

  it('verifies that every package manifest defines valid license, description, keywords, and repository metadata', async () => {
    for (const pkg of packages) {
      const pkgJsonPath = path.resolve('packages', pkg, 'package.json');
      const content = await fs.readFile(pkgJsonPath, 'utf-8');
      const pkgJson = JSON.parse(content);

      // 1. License field
      expect(pkgJson.license).toBe('MIT');

      // 2. Files array must include LICENSE
      expect(Array.isArray(pkgJson.files)).toBe(true);
      expect(pkgJson.files).toContain('LICENSE');
      expect(pkgJson.files).toContain('dist');
      expect(pkgJson.files).toContain('README.md');

      // 3. Description must be substantial
      expect(typeof pkgJson.description).toBe('string');
      expect(pkgJson.description.length).toBeGreaterThan(20);

      // 4. Keywords must contain at least 5 curated tags
      expect(Array.isArray(pkgJson.keywords)).toBe(true);
      expect(pkgJson.keywords.length).toBeGreaterThanOrEqual(5);
      expect(pkgJson.keywords).toContain('shukoi');

      // 5. Repository link with subpath directory
      expect(pkgJson.repository).toBeDefined();
      expect(pkgJson.repository.type).toBe('git');
      expect(pkgJson.repository.url).toBe('git+https://github.com/shukoilab/shukoi.git');
      expect(pkgJson.repository.directory).toBe(`packages/${pkg}`);

      // 6. Homepage, bugs, and author
      expect(pkgJson.homepage).toBe('https://shukoilab.github.io/shukoi/');
      expect(pkgJson.bugs).toBe('https://github.com/shukoilab/shukoi/issues');
      expect(pkgJson.author).toBe('shukoilab');
    }
  });

  it('verifies peerDependenciesMeta contracts for optional runtimes', async () => {
    // @shukoi/selfhost: @hono/node-server is optional (Bun uses native Bun.serve)
    const selfhostPkgPath = path.resolve('packages', 'selfhost', 'package.json');
    const selfhostPkg = JSON.parse(await fs.readFile(selfhostPkgPath, 'utf-8'));
    expect(selfhostPkg.peerDependenciesMeta?.['@hono/node-server']?.optional).toBe(true);
    expect(selfhostPkg.peerDependenciesMeta?.hono).toBeUndefined();

    // @shukoi/mcp: hono is optional (only needed for MCP Streamable HTTP, not STDIO)
    const mcpPkgPath = path.resolve('packages', 'mcp', 'package.json');
    const mcpPkg = JSON.parse(await fs.readFile(mcpPkgPath, 'utf-8'));
    expect(mcpPkg.peerDependenciesMeta?.hono?.optional).toBe(true);
  });

  it('verifies that root package manifest declares valid MIT license, author, and synchronized version', async () => {
    const rootPkgPath = path.resolve('package.json');
    const rootPkg = JSON.parse(await fs.readFile(rootPkgPath, 'utf-8'));

    expect(rootPkg.license).toBe('MIT');
    expect(rootPkg.author).toBe('shukoilab');
    expect(rootPkg.homepage).toBe('https://shukoilab.github.io/shukoi/');
    expect(rootPkg.repository?.url).toBe('git+https://github.com/shukoilab/shukoi.git');
    expect(rootPkg.bugs).toBe('https://github.com/shukoilab/shukoi/issues');

    const corePkgPath = path.resolve('packages', 'core', 'package.json');
    const corePkg = JSON.parse(await fs.readFile(corePkgPath, 'utf-8'));
    expect(rootPkg.version).toBe(corePkg.version);
  });
});
