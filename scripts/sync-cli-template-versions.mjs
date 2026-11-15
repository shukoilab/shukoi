/**
 * @purpose Synchronizes monorepo package versions into create-shukoi scaffolding template constants.
 * @rationale Ensures newly generated user projects reference the exact published version of @shukoi/* instead of stale versions.
 * @preconditions packages/core/package.json and packages/create-shukoi/src/index.ts must exist on disk.
 * @param None
 * @returns {Promise<void>} Resolves when create-shukoi source file is updated.
 * @throws {Error} If core package.json cannot be read or replacement fails.
 * @invariants Pure regex replacement; Big-O O(n) file size; atomic file rewrite.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export async function syncCliTemplateVersions() {
  const corePkgPath = path.join(rootDir, 'packages', 'core', 'package.json');
  const corePkgRaw = await fs.readFile(corePkgPath, 'utf-8');
  const corePkg = JSON.parse(corePkgRaw);
  const version = corePkg.version;

  if (!version) {
    throw new Error('Could not find version in packages/core/package.json');
  }

  const cliIndexPath = path.join(rootDir, 'packages', 'create-shukoi', 'src', 'index.ts');
  const cliIndexRaw = await fs.readFile(cliIndexPath, 'utf-8');

  // Replace all '@shukoi/*': '^...' versions with latest version
  const updatedCliIndex = cliIndexRaw.replace(
    /('@shukoi\/[a-z-]+':\s*')\^[^']+'/g,
    `$1^${version}'`,
  );

  await fs.writeFile(cliIndexPath, updatedCliIndex, 'utf-8');
  console.log(`[sync-cli-template-versions] Synchronized @shukoi/* template versions to ^${version}`);
  return version;
}

// Execute if run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  syncCliTemplateVersions().catch((err) => {
    console.error('[sync-cli-template-versions] Failed:', err);
    process.exit(1);
  });
}
