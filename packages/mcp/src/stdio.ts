/**
 * @purpose Protocol Module B STDIO subpath (@shukoi/mcp/stdio) with sterile stdout, backpressure, and anti-zombie watchdog.
 * @rationale MCP local STDIO communication requires process.stdout to be 100% sterile for JSON-RPC frames. Hijacking console logs to stderr, enforcing drain backpressure, and aborting on stdin closure prevents zombie processes when host IDEs crash.
 * @preconditions Running in Node.js or Bun environment with process.stdin and process.stdout available.
 * @invariants Guaranteed zero stray writes to process.stdout; drain backpressure prevents unbounded write queue growth; process terminates cleanly on pipe closure.
 */

import readline from 'node:readline';
import type { IdempotencyStore, ShukoiConfig, SingleFlightJwksClient } from '@shukoi/core';
import {
  createScopedMcpServer,
  type JsonRpcMessage,
  type McpCatalog,
  type ScopedMcpServerOptions,
} from './shared.js';

/**
 * @purpose Hijacks console.log, console.info, console.warn, and console.debug to redirect all application output to process.stderr.
 * @rationale Guarantees File Descriptor 1 (process.stdout) remains 100% sterile and uncorrupted for newline-delimited JSON-RPC frames.
 * @returns Teardown function restoring original console methods.
 * @throws Never throws.
 * @invariants Pure redirection; thread-safe across all modules in process.
 */
export function hijackConsoleToStderr(): () => void {
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalDebug = console.debug;

  function writeStderr(args: unknown[]): void {
    const formatted = `${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
    process.stderr.write(formatted);
  }

  console.log = (...args: unknown[]) => writeStderr(args);
  console.info = (...args: unknown[]) => writeStderr(args);
  console.warn = (...args: unknown[]) => writeStderr(args);
  console.debug = (...args: unknown[]) => writeStderr(args);

  return () => {
    console.log = originalLog;
    console.info = originalInfo;
    console.warn = originalWarn;
    console.debug = originalDebug;
  };
}

/**
 * @purpose Writes a newline-delimited frame to process.stdout respecting stream backpressure.
 * @rationale Awaits the 'drain' event if the underlying kernel buffer is saturated, preventing unbounded heap consumption.
 * @preconditions frame is a JSON-serializable string without trailing newline.
 * @param frame Text payload to write to stdout.
 * @returns Promise resolving once buffer is flushed and ready for subsequent writes.
 * @throws Never throws unhandled; write errors are captured.
 * @invariants Big-O time complexity O(b) where b is payload bytes; backpressure safe.
 */
export async function writeFrameWithBackpressure(frame: string): Promise<void> {
  const line = `${frame}\n`;
  const ok = process.stdout.write(line);
  if (!ok) {
    await new Promise<void>((resolve) => {
      process.stdout.once('drain', () => resolve());
    });
  }
}

/**
 * @purpose Configures the anti-zombie process watchdog monitoring stdin, stdout, and POSIX signals.
 * @rationale If an IDE (such as VS Code, Cursor, or Claude Desktop) crashes or disconnects its STDIO pipe, the child process must detect EOF and exit code 0 within 200 ms instead of dangling indefinitely as a zombie.
 * @preconditions activeControllers set tracking in-flight operations.
 * @param activeControllers Set of AbortController instances to cancel upon disconnect.
 * @param onCleanup Optional async hook to run before exit.
 * @returns Teardown function removing all watchdog listeners.
 * @throws Never throws.
 * @invariants Guarantees process exit with code 0 upon pipe termination.
 */
export function setupZombieWatchdog(
  activeControllers: Set<AbortController>,
  onCleanup?: () => Promise<void> | void,
): () => void {
  let isTerminating = false;

  const terminateProcess = async () => {
    if (isTerminating) {
      return;
    }
    isTerminating = true;

    // Abort all active operations immediately
    for (const ctrl of activeControllers) {
      ctrl.abort('Parent process disconnected');
    }
    activeControllers.clear();

    if (onCleanup) {
      try {
        await onCleanup();
      } catch {
        // Suppress cleanup errors during emergency shutdown
      }
    }

    process.exit(0);
  };

  const handleStdinClose = () => {
    terminateProcess();
  };

  const handleStdoutError = (err: Error & { code?: string }) => {
    if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') {
      terminateProcess();
    }
  };

  const handleSignal = () => {
    terminateProcess();
  };

  process.stdin.on('end', handleStdinClose);
  process.stdin.on('close', handleStdinClose);
  process.stdout.on('error', handleStdoutError);
  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  // Resume stdin stream so EOF events ('end'/'close') emit even if readline has not attached yet
  if (typeof process.stdin.resume === 'function') {
    process.stdin.resume();
  }

  return () => {
    process.stdin.removeListener('end', handleStdinClose);
    process.stdin.removeListener('close', handleStdinClose);
    process.stdout.removeListener('error', handleStdoutError);
    process.removeListener('SIGINT', handleSignal);
    process.removeListener('SIGTERM', handleSignal);
  };
}

/**
 * @purpose Options for starting an interactive MCP STDIO server.
 * @rationale Injects credentials, services, and persistence layers into the STDIO server runtime.
 * @invariants Readonly options structure.
 */
export interface StdioServerOptions<TServices = unknown> {
  readonly services?: TServices | undefined;
  readonly idempotencyStore?: IdempotencyStore | undefined;
  readonly jwksClient?: SingleFlightJwksClient | undefined;
  readonly staticApiKeys?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * @purpose Starts the MCP STDIO server listening on process.stdin and writing to process.stdout.
 * @rationale Connects local LLM clients (e.g. Claude Desktop, OpenCode, Cursor) directly to Shukoi actions over standard I/O pipes.
 * @preconditions catalog is an McpCatalog; config specifies limits and observability.
 * @param catalog Pre-compiled McpCatalog instance.
 * @param config ShukoiConfig instance.
 * @param options Server dependencies and services.
 * @returns Object providing server lifecycle teardown method.
 * @throws Never throws during startup.
 * @invariants Process stdout sterility enforced; backpressure-safe; anti-zombie monitored.
 */
export function startStdioServer<TServices = unknown>(
  catalog: McpCatalog,
  config: ShukoiConfig,
  options?: StdioServerOptions<TServices>,
) {
  // 1. Hijack console.* to process.stderr
  const restoreConsole = hijackConsoleToStderr();

  const activeControllers = new Set<AbortController>();
  const teardownWatchdog = setupZombieWatchdog(activeControllers);

  const headers: Record<string, string> = {};
  const stdioApiKey = process.env[config.security.stdioApiKeyEnvVar];
  if (stdioApiKey) {
    headers[config.security.apiKeyHeaderName.toLowerCase()] = stdioApiKey;
  }

  const scopedServerOptions: ScopedMcpServerOptions<TServices> = {
    config,
    headers,
    services: options?.services,
    idempotencyStore: options?.idempotencyStore,
    jwksClient: options?.jwksClient,
    staticApiKeys: options?.staticApiKeys,
    onNotification: async (method, params) => {
      const notificationMsg: JsonRpcMessage = {
        jsonrpc: '2.0',
        method,
        params,
      };
      await writeFrameWithBackpressure(JSON.stringify(notificationMsg));
    },
  };

  const scopedServer = createScopedMcpServer(catalog, scopedServerOptions);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    try {
      const parsed = JSON.parse(trimmed) as JsonRpcMessage;
      const response = await scopedServer.handleJsonRpc(parsed);
      if (response !== null) {
        await writeFrameWithBackpressure(JSON.stringify(response));
      }
    } catch (parseErr) {
      const errResponse: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: `Parse error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        },
      };
      await writeFrameWithBackpressure(JSON.stringify(errResponse));
    }
  });

  return {
    async close(): Promise<void> {
      rl.close();
      teardownWatchdog();
      restoreConsole();
      await scopedServer.close();
    },
  };
}

/**
 * @purpose Bridges local STDIO JSON-RPC streams to a remote HTTP MCP endpoint.
 * @rationale Allows developers to run local CLI agents against remote microservices hosted on serverless or cloud infrastructure.
 * @preconditions remoteUrl is a valid HTTP/HTTPS endpoint; config specifies timeout and body limits.
 * @param remoteUrl Remote @shukoi/mcp/http endpoint URL.
 * @param config ShukoiConfig instance.
 * @returns Teardown function stopping the bridge.
 * @throws Never throws during initialization.
 * @invariants Relays frames with backpressure; terminates cleanly on pipe closure.
 */
export function bridgeStdioToHttp(remoteUrl: string, config: ShukoiConfig): () => void {
  const restoreConsole = hijackConsoleToStderr();
  const activeControllers = new Set<AbortController>();
  const teardownWatchdog = setupZombieWatchdog(activeControllers);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    const abortController = new AbortController();
    activeControllers.add(abortController);
    const timeoutSignal = AbortSignal.timeout(config.limits.defaultTimeoutMs);
    const combinedSignal = AbortSignal.any([abortController.signal, timeoutSignal]);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const apiKey = process.env[config.security.stdioApiKeyEnvVar];
      if (apiKey) {
        headers[config.security.apiKeyHeaderName] = apiKey;
      }

      const res = await fetch(remoteUrl, {
        method: 'POST',
        headers,
        body: trimmed,
        signal: combinedSignal,
      });

      if (res.status === 204) {
        return;
      }

      const responseText = await res.text();
      if (responseText.trim()) {
        await writeFrameWithBackpressure(responseText.trim());
      }
    } catch (err) {
      const errResponse: JsonRpcMessage = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32000,
          message: `Bridge forwarding error: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
      await writeFrameWithBackpressure(JSON.stringify(errResponse));
    } finally {
      activeControllers.delete(abortController);
    }
  });

  return () => {
    rl.close();
    teardownWatchdog();
    restoreConsole();
  };
}

export * from './shared.js';
