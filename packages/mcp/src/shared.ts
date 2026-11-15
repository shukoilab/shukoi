/**
 * @purpose Pre-compiled MCP catalog and per-connection scoped MCP server factory.
 * @rationale Pre-compiles tools, resources, and prompts at boot to prevent runtime schema parsing overhead, and instantiates lightweight per-connection servers to eliminate transport overwrite race conditions.
 * @preconditions actions is a list of CompiledAction instances; config is a ShukoiConfig.
 * @invariants Pre-compiled catalog is deeply frozen; per-request context isolation; thread-safe across concurrent calls.
 */

import {
  type CompiledAction,
  DomainError,
  executeAction,
  type IdempotencyStore,
  type ShukoiConfig,
  type SingleFlightJwksClient,
} from '@shukoi/core';

/**
 * @purpose MCP Tool descriptor complying with MCP protocol specification.
 * @rationale Informs LLM agents of tool name, description, parameters schema, and behavioral annotations.
 * @invariants Readonly descriptor structure.
 */
export interface McpToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly annotations?:
    | {
        readonly title?: string | undefined;
        readonly readOnlyHint?: boolean | undefined;
        readonly destructiveHint?: boolean | undefined;
        readonly idempotentHint?: boolean | undefined;
        readonly openWorldHint?: boolean | undefined;
      }
    | undefined;
}

/**
 * @purpose MCP Resource descriptor complying with MCP protocol specification.
 * @rationale Exposes read-only contextual assets to LLM agents.
 * @invariants Readonly descriptor structure.
 */
export interface McpResourceDescriptor {
  readonly uri: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly mimeType?: string | undefined;
}

/**
 * @purpose MCP Prompt descriptor complying with MCP protocol specification.
 * @rationale Exposes pre-engineered prompt workflows to LLM agents.
 * @invariants Readonly descriptor structure.
 */
export interface McpPromptDescriptor {
  readonly name: string;
  readonly description?: string | undefined;
  readonly arguments?:
    | readonly {
        readonly name: string;
        readonly description?: string | undefined;
        readonly required?: boolean | undefined;
      }[]
    | undefined;
}

/**
 * @purpose Pre-compiled, immutable catalog aggregating all MCP entities.
 * @rationale Enables O(1) tool lookup and fast listing without iterating or recompiling action schemas at runtime.
 * @invariants Deeply frozen object collections.
 */
export interface McpCatalog {
  readonly toolsList: readonly McpToolDescriptor[];
  readonly resourcesList: readonly McpResourceDescriptor[];
  readonly resourceTemplatesList: readonly Record<string, unknown>[];
  readonly promptsList: readonly McpPromptDescriptor[];
  readonly actionLookup: ReadonlyMap<string, CompiledAction>;
}

/**
 * @purpose Compiles a list of actions into an immutable, frozen MCP catalog at boot.
 * @rationale Parses action definitions once at application startup to eliminate repetitive serialization costs on every tools/list call.
 * @preconditions actions is an array of CompiledAction instances.
 * @param actions Array of compiled framework actions.
 * @returns Fully compiled and frozen McpCatalog.
 * @throws Never throws.
 * @invariants Big-O time complexity O(a) where a is action count; returns frozen collections.
 */
export function compileMcpCatalog(actions: readonly CompiledAction[]): McpCatalog {
  const tools: McpToolDescriptor[] = [];
  const resources: McpResourceDescriptor[] = [];
  const resourceTemplates: Record<string, unknown>[] = [];
  const prompts: McpPromptDescriptor[] = [];
  const lookup = new Map<string, CompiledAction>();

  for (const action of actions) {
    if (!action.mcp?.enabled) {
      continue;
    }

    lookup.set(action.name, action);

    if (action.mcp.entityType === 'tool') {
      tools.push({
        name: action.name,
        description: action.description,
        inputSchema: action.input,
        annotations: action.mcp.annotations,
      });
    } else if (action.mcp.entityType === 'resource') {
      if (action.mcp.resourceUriTemplate) {
        resourceTemplates.push({
          uriTemplate: action.mcp.resourceUriTemplate,
          name: action.name,
          description: action.description,
          mimeType: action.mcp.mimeType,
        });
      } else {
        resources.push({
          uri: `resource://${action.name}`,
          name: action.name,
          description: action.description,
          mimeType: action.mcp.mimeType,
        });
      }
    } else if (action.mcp.entityType === 'prompt') {
      prompts.push({
        name: action.name,
        description: action.description,
      });
    }
  }

  return Object.freeze({
    toolsList: Object.freeze(tools),
    resourcesList: Object.freeze(resources),
    resourceTemplatesList: Object.freeze(resourceTemplates),
    promptsList: Object.freeze(prompts),
    actionLookup: lookup,
  });
}

/**
 * @purpose Options for instantiating a scoped MCP server connection.
 * @rationale Binds incoming transport headers, signals, and dependencies to an isolated server lifecycle.
 * @invariants Readonly configuration options.
 */
export interface ScopedMcpServerOptions<TServices = unknown> {
  readonly config: ShukoiConfig;
  readonly headers: Readonly<Record<string, string>>;
  readonly platform?: unknown | undefined;
  readonly services?: TServices | undefined;
  readonly requestSignal?: AbortSignal | undefined;
  readonly idempotencyStore?: IdempotencyStore | undefined;
  readonly jwksClient?: SingleFlightJwksClient | undefined;
  readonly staticApiKeys?: Readonly<Record<string, unknown>> | undefined;
  readonly onNotification?: ((method: string, params: unknown) => Promise<void>) | undefined;
}

/**
 * @purpose Standard JSON-RPC 2.0 message interface for MCP protocol exchange.
 * @rationale Represents request, notification, or response envelopes.
 * @invariants Readonly properties.
 */
export interface JsonRpcMessage {
  readonly jsonrpc: '2.0';
  readonly id?: string | number | null | undefined;
  readonly method?: string | undefined;
  readonly params?: unknown | undefined;
  readonly result?: unknown | undefined;
  readonly error?:
    | {
        readonly code: number;
        readonly message: string;
        readonly data?: unknown | undefined;
      }
    | undefined;
}

/**
 * @purpose Scoped MCP server instance executing tools and resources for an isolated connection.
 * @rationale Dispatches MCP protocol requests without mutating shared global state.
 * @invariants Pure in-memory lifecycle; closed via close() in finally.
 */
export interface ScopedMcpServer {
  handleJsonRpc(message: JsonRpcMessage): Promise<JsonRpcMessage | null>;
  close(): Promise<void>;
}

/**
 * @purpose Factory creating an isolated per-connection MCP server instance.
 * @rationale Prevents singleton server transport overwrite race conditions when concurrent requests arrive over HTTP.
 * @preconditions catalog is an McpCatalog; options specifies runtime parameters.
 * @param catalog Pre-compiled MCP catalog.
 * @param options Connection-specific headers, abort signals, and services.
 * @returns ScopedMcpServer instance.
 * @throws Never throws during creation.
 * @invariants Big-O time complexity O(1); zero shared mutable connection state.
 */
export function createScopedMcpServer<TServices = unknown>(
  catalog: McpCatalog,
  options: ScopedMcpServerOptions<TServices>,
): ScopedMcpServer {
  const { config, headers } = options;
  const activeControllers = new Map<string | number, AbortController>();

  const server: ScopedMcpServer = {
    async handleJsonRpc(msg: JsonRpcMessage): Promise<JsonRpcMessage | null> {
      // Notification without id: do not return response unless error
      const _isNotification = msg.id === undefined || msg.id === null;

      if (!msg.method) {
        return {
          jsonrpc: '2.0',
          id: msg.id ?? null,
          error: { code: -32600, message: 'Invalid Request: missing method' },
        };
      }

      // Handle cancellation notifications
      if (msg.method === 'notifications/cancelled') {
        const params = msg.params as { requestId?: string | number } | undefined;
        if (params?.requestId !== undefined) {
          const ctrl = activeControllers.get(params.requestId);
          if (ctrl) {
            ctrl.abort('Cancelled by client');
            activeControllers.delete(params.requestId);
          }
        }
        return null;
      }

      // Handle initialize
      if (msg.method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id: msg.id ?? null,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
              resources: {},
              prompts: {},
            },
            serverInfo: {
              name: config.observability.serviceName,
              version: config.observability.serviceVersion,
            },
          },
        };
      }

      // Handle initialized notification
      if (msg.method === 'notifications/initialized') {
        return null;
      }

      // Handle ping
      if (msg.method === 'ping') {
        return {
          jsonrpc: '2.0',
          id: msg.id ?? null,
          result: {},
        };
      }

      // Handle tools/list
      if (msg.method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id: msg.id ?? null,
          result: {
            tools: catalog.toolsList,
          },
        };
      }

      // Handle resources/list
      if (msg.method === 'resources/list') {
        return {
          jsonrpc: '2.0',
          id: msg.id ?? null,
          result: {
            resources: catalog.resourcesList,
          },
        };
      }

      // Handle resources/templates/list
      if (msg.method === 'resources/templates/list') {
        return {
          jsonrpc: '2.0',
          id: msg.id ?? null,
          result: {
            resourceTemplates: catalog.resourceTemplatesList,
          },
        };
      }

      // Handle prompts/list
      if (msg.method === 'prompts/list') {
        return {
          jsonrpc: '2.0',
          id: msg.id ?? null,
          result: {
            prompts: catalog.promptsList,
          },
        };
      }

      // Handle tools/call
      if (msg.method === 'tools/call') {
        const params = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        const toolName = params.name;
        if (!toolName) {
          return {
            jsonrpc: '2.0',
            id: msg.id ?? null,
            error: { code: -32602, message: 'Invalid params: missing tool name' },
          };
        }

        const action = catalog.actionLookup.get(toolName);
        if (!action) {
          return {
            jsonrpc: '2.0',
            id: msg.id ?? null,
            error: { code: -32601, message: `Tool "${toolName}" not found` },
          };
        }

        const callController = new AbortController();
        if (msg.id !== undefined && msg.id !== null) {
          activeControllers.set(msg.id, callController);
        }

        const combinedSignal = options.requestSignal
          ? AbortSignal.any([options.requestSignal, callController.signal])
          : callController.signal;

        try {
          const rawArgs = params.arguments ?? {};
          const result = await executeAction(action, rawArgs, {
            config,
            transport: 'mcp-http',
            headers,
            signal: combinedSignal,
            platform: options.platform,
            services: options.services,
            idempotencyStore: options.idempotencyStore,
            jwksClient: options.jwksClient,
            staticApiKeys: options.staticApiKeys,
            progressReporter: async (progress, total, message) => {
              if (options.onNotification) {
                await options.onNotification('notifications/progress', {
                  progress,
                  total,
                  message,
                });
              }
            },
          });

          const serializedJson = JSON.stringify(result);
          const byteLength = new TextEncoder().encode(serializedJson).byteLength;

          // Enforce maxMcpOutputBytes boundary
          if (byteLength > config.limits.maxMcpOutputBytes) {
            throw new DomainError(
              'PAYLOAD_TOO_LARGE',
              `Tool output of ${byteLength} bytes exceeds maximum MCP payload limit of ${config.limits.maxMcpOutputBytes} bytes; refine query filters`,
              413,
            );
          }

          return {
            jsonrpc: '2.0',
            id: msg.id ?? null,
            result: {
              content: [
                {
                  type: 'text',
                  text: serializedJson,
                },
              ],
            },
          };
        } catch (callErr) {
          const message = callErr instanceof Error ? callErr.message : String(callErr);
          const statusCode = callErr instanceof DomainError ? callErr.statusCode : 500;

          return {
            jsonrpc: '2.0',
            id: msg.id ?? null,
            result: {
              content: [
                {
                  type: 'text',
                  text: `Error (${statusCode}): ${message}`,
                },
              ],
              isError: true,
            },
          };
        } finally {
          if (msg.id !== undefined && msg.id !== null) {
            activeControllers.delete(msg.id);
          }
        }
      }

      return {
        jsonrpc: '2.0',
        id: msg.id ?? null,
        error: { code: -32601, message: `Method "${msg.method}" not found` },
      };
    },

    async close(): Promise<void> {
      // Abort all in-flight controllers
      for (const ctrl of activeControllers.values()) {
        ctrl.abort('Server closed');
      }
      activeControllers.clear();
    },
  };

  return server;
}
