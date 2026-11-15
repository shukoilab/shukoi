/**
 * @purpose Automated test verifying Biome static analysis guardrails and PRD architectural rule enforcement.
 * @rationale Verifies that Biome rejects node:* imports in web-standard packages and rejects console.log in framework sources.
 * @preconditions @biomejs/biome installed in root monorepo.
 * @param None
 * @returns Test suite passing with exit code 0.
 * @throws Never throws unhandled; asserts test expectations.
 * @invariants Pure static analysis test; Big-O O(1).
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Biome Rule Enforcement Guardrails', () => {
  it('executes pnpm run lint cleanly with zero errors on the codebase', () => {
    const output = execSync('pnpm run lint 2>&1', {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });
    expect(output).toContain('Checked');
  });

  it('rejects forbidden node:* imports in @shukoi/core via noNodejsModules rule', async () => {
    const testFile = path.resolve('packages/core/src/__test_node_import__.ts');
    await fs.writeFile(
      testFile,
      `import fs from 'node:fs';\nexport const read = () => fs.readFileSync('test');\n`,
      'utf-8',
    );

    try {
      expect(() => {
        execSync('pnpm dlx @biomejs/biome check packages/core/src/__test_node_import__.ts', {
          encoding: 'utf-8',
          cwd: process.cwd(),
          stdio: 'pipe',
        });
      }).toThrow();
    } finally {
      await fs.rm(testFile, { force: true });
    }
  });

  it('rejects console.log calls in framework source via noConsole rule', async () => {
    const testFile = path.resolve('packages/api/src/__test_console__.ts');
    await fs.writeFile(testFile, `console.log('leaked stdout');\n`, 'utf-8');

    try {
      expect(() => {
        execSync('pnpm dlx @biomejs/biome check packages/api/src/__test_console__.ts', {
          encoding: 'utf-8',
          cwd: process.cwd(),
          stdio: 'pipe',
        });
      }).toThrow();
    } finally {
      await fs.rm(testFile, { force: true });
    }
  });
});
