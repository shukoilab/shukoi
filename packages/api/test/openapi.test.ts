/**
 * @purpose Unit tests for OpenAPI 3.1.0 document generation from action definitions.
 * @rationale Ensures OpenAPI output conforms to OpenAPI 3.1.0 specifications and reflects input/output schemas.
 * @preconditions Vitest test runner.
 * @invariants Assertions must pass with exit code 0.
 */

import { createDefaultConfig, defineAction } from '@shukoi/core';
import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';
import { generateOpenApiSpec } from '../src/openapi.js';

describe('OpenAPI 3.1 Generator', () => {
  it('generates compliant OpenAPI 3.1 specification for HTTP-enabled actions', () => {
    const getAction = defineAction({
      name: 'getUser',
      summary: 'Get user profile by ID',
      description: 'Retrieves user details',
      tags: ['Users'],
      authRequired: true,
      http: {
        method: 'GET',
        path: '/users/:id',
        successStatus: 200,
      },
      input: Type.Object({
        id: Type.String(),
        includeDetails: Type.Optional(
          Type.Boolean({ description: 'Include extended profile details' }),
        ),
      }),
      output: Type.Object({ id: Type.String(), name: Type.String() }),
      async handler(input) {
        return { id: input.id, name: 'Alice' };
      },
    });

    const createAction = defineAction({
      name: 'createUser',
      summary: 'Creates a new user',
      description: 'Creates user account',
      tags: ['Users'],
      authRequired: false,
      http: {
        method: 'POST',
        path: '/users',
        successStatus: 201,
      },
      input: Type.Object({ name: Type.String(), email: Type.String() }),
      output: Type.Object({ id: Type.String() }),
      async handler() {
        return { id: 'usr-123' };
      },
    });

    const config = createDefaultConfig();
    const spec = generateOpenApiSpec([getAction, createAction], config);

    expect(spec.openapi).toBe('3.1.0');
    expect((spec.info as Record<string, unknown>).title).toBe(config.observability.serviceName);

    // Verify servers definition
    const servers = spec.servers as Array<{ url: string }>;
    expect(servers.length).toBeGreaterThan(0);
    expect(servers[0]?.url).toBe('/');

    // Verify securitySchemes definition
    const components = spec.components as {
      securitySchemes: { bearerAuth: unknown; apiKeyAuth: unknown };
    };
    expect(components.securitySchemes.bearerAuth).toBeDefined();
    expect(components.securitySchemes.apiKeyAuth).toBeDefined();

    const paths = spec.paths as Record<string, Record<string, unknown>>;
    expect(paths['/users/{id}']).toBeDefined();
    expect(paths['/users/{id}']?.get).toBeDefined();

    const getOp = paths['/users/{id}']?.get as Record<string, unknown>;
    expect(getOp.operationId).toBe('getUser');
    expect(getOp.summary).toBe('Get user profile by ID');
    expect(getOp.tags).toEqual(['Users']);

    // Verify security block for authRequired action
    expect(getOp.security).toEqual([{ bearerAuth: [] }, { apiKeyAuth: [] }]);

    // Verify parameters: path parameter + auto-extracted query parameter
    const params = getOp.parameters as Array<{
      name: string;
      in: string;
      required: boolean;
      description?: string;
    }>;
    expect(params.length).toBe(2);

    const pathParam = params.find((p) => p.name === 'id');
    expect(pathParam?.in).toBe('path');
    expect(pathParam?.required).toBe(true);

    const queryParam = params.find((p) => p.name === 'includeDetails');
    expect(queryParam?.in).toBe('query');
    expect(queryParam?.required).toBe(false);
    expect(queryParam?.description).toBe('Include extended profile details');

    // Verify POST operation has requestBody and no security requirements
    const postOp = paths['/users']?.post as Record<string, unknown>;
    expect(postOp.operationId).toBe('createUser');
    expect(postOp.requestBody).toBeDefined();
    expect(postOp.security).toBeUndefined();
  });
});
