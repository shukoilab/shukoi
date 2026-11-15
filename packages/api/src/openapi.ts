/**
 * @purpose Automatic OpenAPI 3.1.0 specification generator from declarative action definitions.
 * @rationale Produces living, fully synchronized OpenAPI 3.1 documentation directly from frozen TypeBox schemas without manual schema synchronization drift.
 * @preconditions actions is a list of CompiledAction instances; config is a ShukoiConfig.
 * @invariants Pure serialization function; Big-O time complexity O(a) where a is total actions.
 */

import type { CompiledAction, ShukoiConfig } from '@shukoi/core';

/**
 * @purpose Converts an Express/Hono route path (:param) into an OpenAPI standard path ({param}).
 * @rationale OpenAPI 3.1 requires curly-bracket parameter templates for path variables.
 * @param path Raw route path (e.g., '/users/:id/orders/:orderId').
 * @returns Converted OpenAPI path (e.g., '/users/{id}/orders/{orderId}').
 * @throws Never throws.
 * @invariants Pure string transformation; regex O(k).
 */
export function formatOpenApiPath(path: string): string {
  return path.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
}

/**
 * @purpose Extracts path parameter names from a route string.
 * @rationale Identifies path variables to automatically generate OpenAPI parameter descriptors.
 * @param path Route path string containing ':param' identifiers.
 * @returns Array of extracted parameter names.
 * @throws Never throws.
 * @invariants O(k) regex scan.
 */
export function extractPathParams(path: string): readonly string[] {
  const matches = path.match(/:([a-zA-Z0-9_]+)/g);
  if (!matches) {
    return [];
  }
  return matches.map((m) => m.slice(1));
}

/**
 * @purpose Generates an OpenAPI 3.1.0 compliant specification document from a list of actions.
 * @rationale Exposes standard machine-readable API documentation for client SDK generators, Swagger UI, and Postman.
 * @param actions Array of CompiledAction definitions to document.
 * @param config ShukoiConfig providing service name and version.
 * @returns Complete OpenAPI 3.1.0 specification document as a JSON-serializable object.
 * @throws Never throws.
 * @invariants Big-O time complexity O(a) where a is action count; returns frozen dictionary.
 */
export function generateOpenApiSpec(
  actions: readonly CompiledAction[],
  config: ShukoiConfig,
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const action of actions) {
    if (!action.http) {
      continue;
    }

    const openApiPath = formatOpenApiPath(action.http.path);
    const method = action.http.method.toLowerCase();
    const pathParams = extractPathParams(action.http.path);

    const parameters: Array<Record<string, unknown>> = pathParams.map((p) => ({
      name: p,
      in: 'path',
      required: true,
      schema: { type: 'string' },
      description: `Path parameter: ${p}`,
    }));

    const successCode = action.http.successStatus ?? 200;

    const operation: Record<string, unknown> = {
      operationId: action.name,
      summary: action.summary ?? action.name,
      description: action.description,
      tags: action.tags ? [...action.tags] : ['Actions'],
      parameters,
      responses: {
        [successCode]: {
          description: 'Successful response',
          content: {
            'application/json': {
              schema: action.output,
            },
          },
        },
        '400': {
          description: 'Bad Request / Malformed Payload',
          content: { 'application/problem+json': { schema: { type: 'object' } } },
        },
        '401': {
          description: 'Unauthorized',
          content: { 'application/problem+json': { schema: { type: 'object' } } },
        },
        '403': {
          description: 'Forbidden / Insufficient Scopes',
          content: { 'application/problem+json': { schema: { type: 'object' } } },
        },
        '413': {
          description: 'Payload Too Large',
          content: { 'application/problem+json': { schema: { type: 'object' } } },
        },
        '422': {
          description: 'Contract Validation Error',
          content: { 'application/problem+json': { schema: { type: 'object' } } },
        },
        '500': {
          description: 'Internal Server Error',
          content: { 'application/problem+json': { schema: { type: 'object' } } },
        },
      },
    };

    if (action.deprecated) {
      operation['deprecated'] = true;
    }

    // Attach requestBody for mutating operations
    if (action.http.method !== 'GET' && action.http.method !== 'DELETE') {
      operation['requestBody'] = {
        required: true,
        content: {
          'application/json': {
            schema: action.input,
          },
        },
      };
    }

    let methodMap = paths[openApiPath];
    if (!methodMap) {
      methodMap = {};
      paths[openApiPath] = methodMap;
    }
    methodMap[method] = operation;
  }

  const spec = {
    openapi: '3.1.0',
    info: {
      title: config.observability.serviceName,
      version: config.observability.serviceVersion,
      description: 'Shukoi Auto-Generated OpenAPI 3.1.0 Specification',
    },
    paths,
  };

  return Object.freeze(spec);
}
