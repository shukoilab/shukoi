/**
 * @purpose Pre-build script to compile showcase Shukoi actions into an OpenAPI 3.1.0 specification document for VitePress documentation.
 * @rationale Provides a static, living OpenAPI 3.1.0 JSON asset served by GitHub Pages and consumed by the interactive Scalar API reference visualizer.
 * @preconditions @shukoi/core and @shukoi/api must be built; docs/public directory must be writable.
 * @param None (CLI execution or module import).
 * @returns {Promise<string>} Resolves with path to written openapi.json on execution.
 * @throws {Error} If action schema compilation or file writing fails.
 * @invariants Pure build-time execution; deterministic output serialization; Big-O O(n) where n is action schema nodes.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDefaultConfig, defineAction } from '@shukoi/core';
import { generateOpenApiSpec } from '@shukoi/api';
import { Type } from '@sinclair/typebox';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

/**
 * @purpose Defines the showcase actions demonstrating Shukoi REST and OpenAPI 3.1 capabilities.
 * @rationale Serves as realistic, production-grade schema models for the public documentation portal.
 * @preconditions Valid TypeBox schemas.
 * @param None.
 * @returns {readonly import('@shukoi/core').CompiledAction[]} Array of compiled actions.
 * @throws Never throws.
 * @invariants Immutable array of compiled actions; Big-O O(1).
 */
export function createShowcaseActions() {
  const processPaymentAction = defineAction({
    name: 'processPayment',
    summary: 'Authorizes and captures a credit card payment with idempotency guarantee',
    description:
      'Processes a single payment transaction using atomic idempotency locks and tokenized credit credentials.',
    authRequired: true,
    input: Type.Object(
      {
        amount: Type.Integer({
          minimum: 100,
          description: 'Transaction amount in smallest currency unit (e.g. cents)',
        }),
        currency: Type.String({
          minLength: 3,
          maxLength: 3,
          description: 'Three-letter ISO 4217 currency code',
          examples: ['USD', 'EUR', 'IDR'],
        }),
        sourceToken: Type.String({
          description: 'Tokenized payment source token obtained via client SDK',
        }),
        customerId: Type.String({
          description: 'Unique customer identifier',
          examples: ['cus_94012'],
        }),
      },
      { additionalProperties: false },
    ),
    output: Type.Object(
      {
        transactionId: Type.String({
          description: 'Unique immutable transaction identifier',
        }),
        status: Type.Union([
          Type.Literal('SUCCEEDED'),
          Type.Literal('PENDING'),
          Type.Literal('FAILED'),
        ]),
        amount: Type.Integer(),
        currency: Type.String(),
        createdAt: Type.String({ format: 'date-time' }),
      },
      { additionalProperties: false },
    ),
    http: {
      method: 'POST',
      path: '/api/v1/payments',
      successStatus: 201,
      requireIdempotencyKey: true,
    },
    mcp: {
      enabled: true,
      entityType: 'tool',
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async handler(input) {
      return {
        transactionId: `txn_${Date.now()}`,
        status: 'SUCCEEDED',
        amount: input.amount,
        currency: input.currency,
        createdAt: new Date().toISOString(),
      };
    },
  });

  const getUserProfileAction = defineAction({
    name: 'getUserProfile',
    summary: 'Retrieves user profile and account status by user ID',
    description: 'Fetches detailed user account information, profile settings, and subscription status.',
    authRequired: true,
    input: Type.Object(
      {
        id: Type.String({
          description: 'Target user ID passed in URL path',
          examples: ['usr_1002'],
        }),
        includeStats: Type.Optional(
          Type.Boolean({
            description: 'Optional query flag to include aggregate activity statistics',
          }),
        ),
      },
      { additionalProperties: false },
    ),
    output: Type.Object(
      {
        id: Type.String(),
        email: Type.String({ format: 'email' }),
        name: Type.String(),
        role: Type.Union([Type.Literal('admin'), Type.Literal('member'), Type.Literal('viewer')]),
        createdAt: Type.String({ format: 'date-time' }),
      },
      { additionalProperties: false },
    ),
    http: {
      method: 'GET',
      path: '/api/v1/users/:id',
      successStatus: 200,
    },
    mcp: {
      enabled: true,
      entityType: 'tool',
      annotations: {
        readOnlyHint: true,
      },
    },
    async handler(input) {
      return {
        id: input.id,
        email: 'user@example.com',
        name: 'Jane Doe',
        role: 'member',
        createdAt: '2026-01-15T10:00:00Z',
      };
    },
  });

  const listEventsAction = defineAction({
    name: 'listEvents',
    summary: 'Lists security and audit log events with multi-value filtering',
    description:
      'Queries audit trail log records supporting array query parameters and timestamp boundaries.',
    authRequired: true,
    input: Type.Object(
      {
        tags: Type.Optional(
          Type.Array(Type.String(), {
            description: 'Multi-value query parameter array of event tags (e.g. ?tags=auth&tags=deploy)',
          }),
        ),
        limit: Type.Optional(
          Type.Integer({
            minimum: 1,
            maximum: 100,
            description: 'Maximum records to return (default 50)',
          }),
        ),
      },
      { additionalProperties: false },
    ),
    output: Type.Object(
      {
        events: Type.Array(
          Type.Object({
            id: Type.String(),
            type: Type.String(),
            timestamp: Type.String({ format: 'date-time' }),
          }),
        ),
        total: Type.Integer(),
      },
      { additionalProperties: false },
    ),
    http: {
      method: 'GET',
      path: '/api/v1/events',
      successStatus: 200,
    },
    async handler(input) {
      return {
        events: [
          { id: 'evt_1', type: 'user.login', timestamp: new Date().toISOString() },
        ],
        total: 1,
      };
    },
  });

  const healthCheckAction = defineAction({
    name: 'healthCheck',
    summary: 'Kubernetes and load balancer liveness health probe',
    description: 'Returns instant HTTP 200 status indicating application availability.',
    authRequired: false,
    input: Type.Object({}, { additionalProperties: false }),
    output: Type.Object(
      {
        status: Type.Literal('HEALTHY'),
        uptimeSeconds: Type.Number(),
        timestamp: Type.String({ format: 'date-time' }),
      },
      { additionalProperties: false },
    ),
    http: {
      method: 'GET',
      path: '/healthz',
      successStatus: 200,
    },
    async handler() {
      return {
        status: 'HEALTHY',
        uptimeSeconds: 120.5,
        timestamp: new Date().toISOString(),
      };
    },
  });

  return [processPaymentAction, getUserProfileAction, listEventsAction, healthCheckAction];
}

/**
 * @purpose Compiles showcase actions into an OpenAPI 3.1.0 document and writes to docs/public/openapi.json.
 * @rationale Ensures docs site has up-to-date OpenAPI spec on every build.
 * @preconditions Workspace packages compiled.
 * @param None.
 * @returns {Promise<string>} Path to written openapi.json.
 * @throws {Error} If compilation or file writing fails.
 * @invariants Atomic write; Big-O O(n) schema traversal.
 */
export async function generateDocsSpec() {
  const actions = createShowcaseActions();
  const config = createDefaultConfig({
    service: {
      name: 'Shukoi Showcase API',
      version: '1.0.2',
    },
    security: {
      allowedOrigins: ['*'],
      apiKeyHeaderName: 'x-api-key',
    },
  });

  const spec = generateOpenApiSpec(actions, config);
  const publicDir = path.join(rootDir, 'docs', 'public');
  await fs.mkdir(publicDir, { recursive: true });

  const targetPath = path.join(publicDir, 'openapi.json');
  await fs.writeFile(targetPath, JSON.stringify(spec, null, 2), 'utf-8');
  console.log(`[generate-docs-spec] Generated OpenAPI 3.1.0 spec at: ${targetPath}`);
  return targetPath;
}

// Execute standalone if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateDocsSpec().catch((err) => {
    console.error('[generate-docs-spec] Error:', err);
    process.exit(1);
  });
}
