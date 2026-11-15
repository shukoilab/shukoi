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
    const action = defineAction({
      name: 'getUser',
      summary: 'Get user profile by ID',
      description: 'Retrieves user details',
      tags: ['Users'],
      authRequired: false,
      http: {
        method: 'GET',
        path: '/users/:id',
        successStatus: 200,
      },
      input: Type.Object({ id: Type.String() }),
      output: Type.Object({ id: Type.String(), name: Type.String() }),
      async handler(input) {
        return { id: input.id, name: 'Alice' };
      },
    });

    const config = createDefaultConfig();
    const spec = generateOpenApiSpec([action], config);

    expect(spec.openapi).toBe('3.1.0');
    expect((spec.info as Record<string, unknown>).title).toBe(config.observability.serviceName);

    const paths = spec.paths as Record<string, Record<string, unknown>>;
    expect(paths['/users/{id}']).toBeDefined();
    expect(paths['/users/{id}']?.get).toBeDefined();

    const getOp = paths['/users/{id}']?.get as Record<string, unknown>;
    expect(getOp.operationId).toBe('getUser');
    expect(getOp.summary).toBe('Get user profile by ID');
    expect(getOp.tags).toEqual(['Users']);
  });
});
