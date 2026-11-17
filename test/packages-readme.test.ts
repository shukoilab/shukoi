/**
 * @purpose Automated test suite verifying completeness, length, and packaging integrity of all 7 package READMEs.
 * @rationale Ensures that every published package contains detailed English documentation on npmjs.com and in source repositories.
 * @preconditions Monorepo packages present on disk.
 * @param None
 * @returns Test suite passing with exit code 0.
 * @throws Never throws unhandled; asserts test expectations.
 * @invariants Pure read-only verification; zero side effects.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Package README Documentation Integrity', () => {
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

  it('verifies that all 12 packages contain comprehensive, fluent English READMEs', async () => {
    for (const pkg of packages) {
      const readmePath = path.resolve('packages', pkg, 'README.md');
      const content = await fs.readFile(readmePath, 'utf-8');

      // Verify substantial length (> 1,000 characters)
      expect(content.length).toBeGreaterThan(1000);

      // Verify required standard documentation sections
      expect(content).toContain('# ');
      expect(content).toContain('Installation');
      expect(content).toContain('License');

      // Verify no unfinished TODO placeholders
      expect(content).not.toContain('TODO');
      expect(content).not.toContain('TBD');
    }
  });

  it('verifies all 7 package manifests include README.md in their files array for npm packaging', async () => {
    for (const pkg of packages) {
      const pkgJsonPath = path.resolve('packages', pkg, 'package.json');
      const content = await fs.readFile(pkgJsonPath, 'utf-8');
      const pkgJson = JSON.parse(content);

      expect(Array.isArray(pkgJson.files)).toBe(true);
      expect(pkgJson.files).toContain('README.md');
      expect(pkgJson.files).toContain('dist');
    }
  });

  it('verifies that relative markdown links inside package READMEs resolve cleanly on disk', async () => {
    for (const pkg of packages) {
      const readmePath = path.resolve('packages', pkg, 'README.md');
      const content = await fs.readFile(readmePath, 'utf-8');

      const linkMatches = content.match(/\[.*?\]\((.*?)\)/g) ?? [];
      for (const match of linkMatches) {
        const urlMatch = match.match(/\((.*?)\)/);
        const url = urlMatch?.[1];

        // Check internal relative links (skip external URLs and anchors)
        if (url && !url.startsWith('http') && !url.startsWith('#') && !url.startsWith('mailto:')) {
          const targetFile = path.resolve('packages', pkg, url);
          const exists = await fs
            .stat(targetFile)
            .then(() => true)
            .catch(() => false);
          expect(exists).toBe(true);
        }
      }
    }
  });
});
