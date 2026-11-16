/**
 * @purpose Automated test suite verifying AI context documents, Agent Skills compliance, ADR structure, and link integrity.
 * @rationale Ensures all Agent Skills adhere to agentskills.io YAML frontmatter standards and documentation links do not rot.
 * @preconditions Documentation files and skills directories present on disk.
 * @param None
 * @returns Test suite passing with exit code 0.
 * @throws Never throws unhandled; asserts test expectations.
 * @invariants Pure read-only verification assertions; zero side effects.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AI Context & Documentation Architecture', () => {
  it('validates that all Agent Skills comply with the agentskills.io standard', async () => {
    const skillsDir = path.resolve('skills');
    const skillFolders = await fs.readdir(skillsDir);

    expect(skillFolders.length).toBeGreaterThanOrEqual(3);

    for (const folder of skillFolders) {
      const skillMdPath = path.join(skillsDir, folder, 'SKILL.md');
      const content = await fs.readFile(skillMdPath, 'utf-8');

      // Verify YAML frontmatter presence
      expect(content.startsWith('---\n')).toBe(true);
      const secondDashes = content.indexOf('\n---\n', 4);
      expect(secondDashes).toBeGreaterThan(0);

      const frontmatterText = content.slice(4, secondDashes);
      const lines = frontmatterText.split('\n');

      const nameLine = lines.find((l) => l.startsWith('name:'));
      expect(nameLine).toBeDefined();
      const name = nameLine?.slice(5).trim();

      // Rule: name must match directory name and regex ^[a-z0-9-]+$
      expect(name).toBe(folder);
      if (name) {
        expect(/^[a-z0-9-]+$/.test(name)).toBe(true);
        expect(name.length).toBeLessThanOrEqual(64);
      }

      // Rule: description must be non-empty and <= 1024 chars
      const descLine = lines.find((l) => l.startsWith('description:'));
      expect(descLine).toBeDefined();
      const description = descLine?.slice(12).trim();
      expect(description?.length).toBeGreaterThan(10);
      expect(description?.length).toBeLessThanOrEqual(1024);
    }
  });

  it('validates all 5 Architecture Decision Records (ADRs) exist with required sections', async () => {
    const adrDir = path.resolve('docs', 'adr');
    const expectedAdrs = [
      '001-adaptive-typebox-jit.md',
      '002-per-request-mcp-server.md',
      '003-single-flight-jwks-discovery.md',
      '004-stream-bounded-body-parsing.md',
      '005-sterile-stdout-and-anti-zombie.md',
    ];

    for (const file of expectedAdrs) {
      const adrPath = path.join(adrDir, file);
      const content = await fs.readFile(adrPath, 'utf-8');

      expect(content).toContain('# ADR 00');
      expect(content).toContain('## Status');
      expect(content).toContain('## Context');
      expect(content).toContain('## Decision');
      expect(content).toContain('## Consequences for AI Agents');
    }
  });

  it('verifies all 7 packages contain scoped AGENTS.md constitutions', async () => {
    const packages = ['core', 'api', 'mcp', 'cloudflare', 'lambda', 'selfhost', 'create-shukoi'];

    for (const pkg of packages) {
      const agentsMdPath = path.resolve('packages', pkg, 'AGENTS.md');
      const content = await fs.readFile(agentsMdPath, 'utf-8');
      expect(content).toContain('Constitution');
      expect(content).toContain('Invariants & Non-Negotiable Rules');
    }
  });

  it('verifies root documentation files and ensures zero broken links', async () => {
    const rootFiles = ['AGENTS.md', 'CLAUDE.md', 'README.md', 'llms.txt', 'llms-full.txt'];

    for (const file of rootFiles) {
      const filePath = path.resolve(file);
      const stat = await fs.stat(filePath);
      expect(stat.size).toBeGreaterThan(0);
    }

    // Verify CLAUDE.md points to AGENTS.md
    const claudeMd = await fs.readFile(path.resolve('CLAUDE.md'), 'utf-8');
    expect(claudeMd).toContain('@AGENTS.md');

    // Verify llms.txt links resolve to real files
    const llmsTxt = await fs.readFile(path.resolve('llms.txt'), 'utf-8');
    const linkMatches = llmsTxt.match(/\[.*?\]\((.*?)\)/g) ?? [];
    expect(linkMatches.length).toBeGreaterThan(0);

    for (const match of linkMatches) {
      const matchGroups = match.match(/\((.*?)\)/);
      const url = matchGroups?.[1];
      if (url && !url.startsWith('http')) {
        const targetFile = path.resolve(url);
        const exists = await fs
          .stat(targetFile)
          .then(() => true)
          .catch(() => false);
        expect(exists).toBe(true);
      }
    }
  });

  it('validates shukoi-deploy-target skill and runtime-matrix completeness', async () => {
    const deploySkillPath = path.resolve('skills', 'shukoi-deploy-target', 'SKILL.md');
    const deploySkillContent = await fs.readFile(deploySkillPath, 'utf-8');

    expect(deploySkillContent).toContain('@shukoi/cloudflare');
    expect(deploySkillContent).toContain('@shukoi/lambda');
    expect(deploySkillContent).toContain('@shukoi/selfhost');
    expect(deploySkillContent).toContain('getCloudflareContext');
    expect(deploySkillContent).toContain('getLambdaContext');
    expect(deploySkillContent).toContain('getSelfHostContext');
    expect(deploySkillContent).toContain('@shukoi/cloudflare/testing');
    expect(deploySkillContent).toContain('@shukoi/lambda/testing');
    expect(deploySkillContent).toContain('@shukoi/selfhost/testing');

    const matrixPath = path.resolve(
      'skills',
      'shukoi-deploy-target',
      'references',
      'runtime-matrix.md',
    );
    const matrixContent = await fs.readFile(matrixPath, 'utf-8');
    expect(matrixContent).toContain('Cloudflare Workers');
    expect(matrixContent).toContain('AWS Lambda');
    expect(matrixContent).toContain('Self-Host Server');
    expect(matrixContent).toContain('Ingress Cookie Parsing');
    expect(matrixContent).toContain('Egress Cookie Preservation');
    expect(matrixContent).toContain('Binary Response Handling');
    expect(matrixContent).toContain('In-Memory Testing Subpath');

    const archPath = path.resolve('docs', 'ARCHITECTURE.md');
    const archContent = await fs.readFile(archPath, 'utf-8');
    expect(archContent).toContain('## 7. Runtime Adapters & Edge-to-Cloud Deployment Architecture');
    expect(archContent).toContain('7.1 Cloudflare Workers Adapter');
    expect(archContent).toContain('7.2 AWS Lambda Adapter');
    expect(archContent).toContain('7.3 Self-Host Server Adapter');
  });

  it('validates Protocol Module A (API) and B (MCP) documentation and architecture completeness', async () => {
    // 1. docs/ARCHITECTURE.md Section 8 and Section 9
    const archPath = path.resolve('docs', 'ARCHITECTURE.md');
    const archContent = await fs.readFile(archPath, 'utf-8');
    expect(archContent).toContain(
      '## 8. Protocol Module A: REST, OpenAPI 3.1.0 & RFC 9457 Architecture',
    );
    expect(archContent).toContain('8.1 Deterministic Parameter Merge Priority');
    expect(archContent).toContain('8.2 Stream-Bounded Body Parsing');
    expect(archContent).toContain('8.3 Safe Primitive Coercion & Array Query Parameters');
    expect(archContent).toContain('8.4 Automated OpenAPI 3.1.0 Specification Compilation');
    expect(archContent).toContain('8.5 Universal RFC 9457 Problem Details State Machine');

    expect(archContent).toContain(
      '## 9. Protocol Module B: Model Context Protocol (MCP) Architecture',
    );
    expect(archContent).toContain('9.1 Stateless Per-Request Scoped Servers (ADR-002)');
    expect(archContent).toContain('9.2 Complete Native Support for Core MCP Primitives');
    expect(archContent).toContain('9.3 Streamable HTTP Transport');
    expect(archContent).toContain('9.4 Sterile STDIO Transport & Anti-Zombie Watchdog');

    // 2. packages/api/README.md
    const apiReadmePath = path.resolve('packages', 'api', 'README.md');
    const apiReadmeContent = await fs.readFile(apiReadmePath, 'utf-8');
    expect(apiReadmeContent).toContain('OpenAPI 3.1.0');
    expect(apiReadmeContent).toContain('readBoundedJsonStream');
    expect(apiReadmeContent).toContain('RFC 9457');
    expect(apiReadmeContent).toContain('Deterministic Parameter Merge Priority');
    expect(apiReadmeContent).toContain('Multi-Value Array Query Parameters');
    expect(apiReadmeContent).toContain('Safe Primitive Coercion');
    expect(apiReadmeContent).toContain('docs/ARCHITECTURE.md');

    // 3. packages/mcp/README.md
    const mcpReadmePath = path.resolve('packages', 'mcp', 'README.md');
    const mcpReadmeContent = await fs.readFile(mcpReadmePath, 'utf-8');
    expect(mcpReadmeContent).toContain('Core MCP Primitives Supported');
    expect(mcpReadmeContent).toContain('tools/call');
    expect(mcpReadmeContent).toContain('resources/read');
    expect(mcpReadmeContent).toContain('prompts/get');
    expect(mcpReadmeContent).toContain('@shukoi/mcp/http');
    expect(mcpReadmeContent).toContain('@shukoi/mcp/stdio');
    expect(mcpReadmeContent).toContain('DELETE /mcp');
    expect(mcpReadmeContent).toContain('docs/ARCHITECTURE.md');

    // 4. skills/shukoi-create-action/SKILL.md
    const createActionSkillPath = path.resolve('skills', 'shukoi-create-action', 'SKILL.md');
    const createActionSkillContent = await fs.readFile(createActionSkillPath, 'utf-8');
    expect(createActionSkillContent).toContain("entityType: 'tool'");
    expect(createActionSkillContent).toContain("entityType: 'resource'");
    expect(createActionSkillContent).toContain("entityType: 'prompt'");

    // 5. skills/shukoi-deploy-target/SKILL.md
    const deploySkillPath = path.resolve('skills', 'shukoi-deploy-target', 'SKILL.md');
    const deploySkillContent = await fs.readFile(deploySkillPath, 'utf-8');
    expect(deploySkillContent).toContain('mountMcpHttpRoutes');
    expect(deploySkillContent).toContain('startStdioServer');
  });
});
