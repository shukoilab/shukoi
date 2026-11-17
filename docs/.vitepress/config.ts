/**
 * @purpose VitePress documentation site configuration for the Shukoi framework.
 * @rationale Configures multi-level navigation, sidebar routing, theme, local search, and dynamic base path resolution for GitHub Pages deployment.
 * @preconditions Valid TypeScript environment; VitePress 1.x runtime.
 * @param None.
 * @returns UserConfig object defining site metadata, theme, and navigation.
 * @throws Never throws.
 * @invariants Pure declarative configuration object; deterministic SSR serialization; Big-O O(1).
 */

import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitepress';

const corePkg = JSON.parse(
  readFileSync(new URL('../../packages/core/package.json', import.meta.url), 'utf-8'),
);
const activeVersion = `v${corePkg.version}`;

const basePath = process.env.BASE_URL || '/shukoi/';

export default defineConfig({
  title: 'Shukoi',
  description: 'The Universal Action Framework for Humans and AI Agents',
  base: basePath,
  lastUpdated: true,
  cleanUrls: true,
  head: [
    ['link', { rel: 'icon', href: `${basePath}logo.svg` }],
    ['meta', { name: 'theme-color', content: '#0ea5e9' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Shukoi Framework Documentation' }],
    [
      'meta',
      {
        property: 'og:description',
        content: 'Universal Action Framework for Cloudflare, AWS Lambda, Node, Bun, and AI Agents',
      },
    ],
  ],
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Shukoi',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Protocols', link: '/protocols/rest-api' },
      { text: 'Runtimes', link: '/runtimes/cloudflare' },
      { text: 'Architecture', link: '/architecture/overview' },
      { text: 'API Reference', link: '/reference/api' },
      {
        text: activeVersion,
        items: [
          { text: 'Changelog', link: 'https://github.com/shukoilab/shukoi/releases' },
          { text: 'NPM Registry', link: 'https://www.npmjs.com/package/@shukoi/core' },
        ],
      },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'The Action Pattern', link: '/guide/actions' },
          ],
        },
        {
          text: 'Core Fundamentals',
          items: [
            { text: 'Error Handling (RFC 9457)', link: '/guide/errors' },
            { text: 'Testing & Mocks', link: '/guide/testing' },
          ],
        },
        {
          text: 'Resilience & Concurrency',
          items: [
            { text: 'Distributed Idempotency', link: '/guide/idempotency' },
            { text: 'Rate Limiting & Quotas', link: '/guide/rate-limiting' },
          ],
        },
        {
          text: 'Security & Observability',
          items: [
            { text: 'Enterprise Authentication', link: '/guide/authentication' },
            { text: 'RBAC & ABAC Authorization', link: '/guide/authorization-rbac' },
            { text: 'OpenTelemetry & Metrics', link: '/guide/observability-otel' },
          ],
        },
        {
          text: 'Data & Persistence',
          items: [
            { text: 'Transactions & ORMs', link: '/guide/database-and-transactions' },
            { text: 'Transactional Outbox', link: '/guide/transactional-outbox' },
          ],
        },
      ],
      '/protocols/': [
        {
          text: 'Protocol Modules',
          items: [
            { text: 'Module A: REST & OpenAPI 3.1', link: '/protocols/rest-api' },
            { text: 'Module B: Model Context Protocol (MCP)', link: '/protocols/mcp' },
          ],
        },
      ],
      '/runtimes/': [
        {
          text: 'Edge to Cloud Runtimes',
          items: [
            { text: 'Cloudflare Workers (V8 Isolates)', link: '/runtimes/cloudflare' },
            { text: 'AWS Lambda (Serverless)', link: '/runtimes/lambda' },
            { text: 'Self-Host Server (Bun & Node)', link: '/runtimes/selfhost' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: 'System Specifications',
          items: [
            { text: 'System Architecture', link: '/architecture/overview' },
            { text: 'Architecture Decision Records (ADRs)', link: '/architecture/adrs' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'API & Agent Reference',
          items: [
            { text: 'Interactive OpenAPI (Scalar)', link: '/reference/api' },
            { text: 'Scoped Package Matrix', link: '/reference/package-matrix' },
            { text: 'Agent Skills & LLMs', link: '/reference/agents' },
          ],
        },
      ],
    },
    search: {
      provider: 'local',
      options: {
        detailedView: true,
      },
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/shukoilab/shukoi' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/@shukoi/core' },
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Shukoi Contributors',
    },
  },
});
