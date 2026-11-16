/**
 * @purpose Protocol Module B HTTP subpath (@shukoi/mcp/http) with DNS-rebinding protection and stateless lifecycle.
 * @rationale Implements the Streamable HTTP MCP transport with Host and Origin pinning, preventing DNS rebinding and cross-request state contamination in serverless environments.
 * @preconditions catalog is pre-compiled McpCatalog; config specifies allowed hosts and origins.
 * @invariants Pure Web-Standard implementation; zero node:* imports; per-request scoped server teardown in finally.
 */

import type { IdempotencyStore, ShukoiConfig, SingleFlightJwksClient } from '@shukoi/core';
import type { Hono } from 'hono';
import {
  createScopedMcpServer,
  type JsonRpcMessage,
  type McpCatalog,
  type ScopedMcpServerOptions,
} from './shared.js';

/**
 * @purpose Options parameterizing the MCP HTTP endpoint handler.
 * @rationale Permits injecting dependency services, persistence stores, and auth clients into MCP HTTP handlers.
 * @invariants Readonly options structure.
 */
export interface McpHttpOptions<TServices = unknown> {
  readonly services?: TServices | undefined;
  readonly idempotencyStore?: IdempotencyStore | undefined;
  readonly jwksClient?: SingleFlightJwksClient | undefined;
  readonly staticApiKeys?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * @purpose Verifies incoming Host and Origin headers to guard against DNS-rebinding attacks.
 * @rationale MCP HTTP endpoints exposed on local networks or serverless runtimes are vulnerable to malicious websites rebinding DNS to localhost unless Host and Origin are strictly pinned.
 * @param req Web-standard Request instance.
 * @param config ShukoiConfig specifying security allowlists.
 * @returns true if allowed; false if rejected.
 * @throws Never throws internally.
 * @invariants Big-O time complexity O(h) where h is allowlist count; constant-time hostname extraction.
 */
export function verifyHostAndOrigin(req: Request, config: ShukoiConfig): boolean {
  // 1. Host header validation
  const hostHeader = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  const hostname = hostHeader.split(':')[0]?.toLowerCase() ?? '';

  if (config.security.allowedHosts.length > 0 && hostname.length > 0) {
    const isHostAllowed = config.security.allowedHosts.some(
      (allowed) => allowed === '*' || allowed.toLowerCase() === hostname,
    );
    if (!isHostAllowed) {
      return false;
    }
  }

  // 2. Origin header validation (if Origin header is present)
  const origin = req.headers.get('origin');
  if (origin && config.security.allowedOrigins.length > 0) {
    const isOriginAllowed = config.security.allowedOrigins.some(
      (allowed) => allowed === '*' || allowed === origin,
    );
    if (!isOriginAllowed) {
      return false;
    }
  }

  return true;
}

/**
 * @purpose Flattens request headers into a normalized lowercase key-value record.
 * @rationale Extracts authentication and correlation identifiers for the scoped server context.
 * @param req Web-standard Request instance.
 * @returns Plain string record of headers.
 * @throws Never throws.
 * @invariants O(h) where h is header count.
 */
function extractHeaders(req: Request): Record<string, string> {
  const result: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

/**
 * @purpose Standalone fetch request handler for MCP HTTP endpoints.
 * @rationale Enables embedding the MCP HTTP endpoint directly into Web-standard runtimes (Cloudflare Workers, Bun, Lambda).
 * @preconditions catalog and config provided.
 * @param catalog Pre-compiled MCP catalog.
 * @param config ShukoiConfig instance.
 * @param options Router and service options.
 * @returns Async function processing incoming HTTP Requests into Responses.
 * @throws Never throws unhandled; returns standard JSON-RPC 2.0 or HTTP error responses.
 * @invariants Stateless request execution; scopedServer.close() guaranteed in finally block.
 */
export function createMcpHttpHandler<TServices = unknown>(
  catalog: McpCatalog,
  config: ShukoiConfig,
  options?: McpHttpOptions<TServices>,
): (req: Request, platform?: unknown) => Promise<Response> {
  return async (req: Request, platform?: unknown): Promise<Response> => {
    // 1. DNS-Rebinding Defense Gate
    if (!verifyHostAndOrigin(req, config)) {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32000,
            message: 'Forbidden: Host or Origin rejected by DNS-rebinding security policy',
          },
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    if (req.method === 'GET') {
      // Return server capabilities and catalog summary
      return new Response(
        JSON.stringify({
          name: config.observability.serviceName,
          version: config.observability.serviceVersion,
          toolsCount: catalog.toolsList.length,
          resourcesCount: catalog.resourcesList.length,
          promptsCount: catalog.promptsList.length,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    if (req.method === 'DELETE') {
      // In stateless mode, session termination is a clean no-op returning 204 No Content
      return new Response(null, { status: 204 });
    }

    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const acceptHeader = req.headers.get('accept');
    if (
      acceptHeader &&
      !acceptHeader.includes('*/*') &&
      !acceptHeader.includes('application/json') &&
      !acceptHeader.includes('text/event-stream')
    ) {
      return new Response(
        'Not Acceptable: client must accept application/json or text/event-stream',
        { status: 406 },
      );
    }

    const headers = extractHeaders(req);
    const scopedServerOptions: ScopedMcpServerOptions<TServices> = {
      config,
      headers,
      platform,
      services: options?.services,
      requestSignal: req.signal,
      idempotencyStore: options?.idempotencyStore,
      jwksClient: options?.jwksClient,
      staticApiKeys: options?.staticApiKeys,
    };

    const scopedServer = createScopedMcpServer(catalog, scopedServerOptions);

    try {
      const rawText = await req.text();
      if (!rawText.trim()) {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error: empty request body' },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error: invalid JSON' },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Handle batch JSON-RPC requests
      if (Array.isArray(parsed)) {
        if (parsed.length > config.limits.maxRpcBatchSize) {
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: {
                code: -32600,
                message: `Batch request size ${parsed.length} exceeds maximum limit of ${config.limits.maxRpcBatchSize}`,
              },
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }

        const responses: JsonRpcMessage[] = [];
        for (const item of parsed) {
          const res = await scopedServer.handleJsonRpc(item as JsonRpcMessage);
          if (res !== null) {
            responses.push(res);
          }
        }

        return new Response(JSON.stringify(responses), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Single JSON-RPC request
      const response = await scopedServer.handleJsonRpc(parsed as JsonRpcMessage);
      if (response === null) {
        // Notification accepted
        return new Response(null, { status: 204 });
      }

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      await scopedServer.close();
    }
  };
}

/**
 * @purpose Mounts the MCP HTTP handler onto a Hono application instance.
 * @rationale Simplifies co-hosting the REST API and MCP HTTP interfaces on the same port and server.
 * @param app Hono router instance.
 * @param path Mount path (e.g. '/mcp').
 * @param catalog Pre-compiled McpCatalog.
 * @param config ShukoiConfig instance.
 * @param options McpHttpOptions configuration.
 * @returns void
 * @throws Never throws.
 * @invariants Registers POST and GET handlers on specified path.
 */
export function mountMcpHttpRoutes<TServices = unknown>(
  app: Hono,
  path: string,
  catalog: McpCatalog,
  config: ShukoiConfig,
  options?: McpHttpOptions<TServices>,
): void {
  const handler = createMcpHttpHandler(catalog, config, options);

  app.all(path, async (c) => {
    return handler(c.req.raw, c.env);
  });
}

export * from './shared.js';
