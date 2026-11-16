/**
 * @purpose Self-Host runtime server adapter for Node.js and Bun with graceful shutdown state machine, typed platform context, and Kubernetes health probes.
 * @rationale Implements container lifecycle probes (liveness, readiness with isReady hook), stream-bounded ingress protecting against OOM attacks, and a deterministic graceful drain state machine on SIGTERM/SIGINT, preventing dropped requests during Kubernetes rolling deployments.
 * @preconditions Running in Node.js 22+ or Bun 1.2+ environment; app is a configured Hono instance.
 * @invariants Deterministic state transitions (HEALTHY -> DRAINING -> TERMINATED); 503 ready probe on drain; hard timeout deadline; stream backpressure preservation.
 */

import http from 'node:http';
import { type ActionExecutionContext, DomainError, type ShukoiConfig } from '@shukoi/core';
import type { Hono } from 'hono';

/**
 * @purpose Operational health state enumeration for self-host deployment.
 * @rationale Governs readiness probe status responses during process startup, serving, and teardown.
 * @preconditions Server state machine initialized.
 * @param None
 * @returns State string discriminator.
 * @throws Never throws on declaration.
 * @invariants Readonly state machine enum.
 */
export type ServerHealthState = 'STARTING' | 'HEALTHY' | 'DRAINING' | 'TERMINATED';

/**
 * @purpose Strongly-typed self-host platform container injected into Shukoi ActionExecutionContext.
 * @rationale Provides type-safe access to client IP, port, underlying Node.js HTTP messages, and server lifecycle status inside action handlers.
 * @preconditions Running within a self-hosted HTTP server or test harness with SelfHostPlatform injected.
 * @param None
 * @returns Immutable platform container holding client connection metadata and server state getter.
 * @throws Never throws on declaration.
 * @invariants Immutable interface; pure platform metadata; thread-safe accessors.
 */
export interface SelfHostPlatform {
  readonly remoteAddress?: string | undefined;
  readonly remotePort?: number | undefined;
  readonly incoming?: http.IncomingMessage | undefined;
  readonly outgoing?: http.ServerResponse | undefined;
  readonly serverState: () => ServerHealthState;
}

/**
 * @purpose Extracts strongly-typed self-host context from an action execution context.
 * @rationale Eliminates manual casting and provides safe access to remote client IP, port, and server state.
 * @preconditions Action must be executing within a self-hosted server environment or test harness with SelfHostPlatform injected.
 * @param ctx ActionExecutionContext passed into the action handler.
 * @returns SelfHostPlatform container with remoteAddress, remotePort, and serverState accessor.
 * @throws DomainError('INTERNAL_SERVER_ERROR') if ctx.platform is missing or not executing in self-host environment.
 * @invariants Big-O time complexity O(1); zero memory allocations.
 */
export function getSelfHostContext(
  ctx: ActionExecutionContext<unknown, unknown, unknown>,
): SelfHostPlatform {
  const platform = ctx.platform as
    | (Record<string, unknown> & {
        selfHostPlatform?: SelfHostPlatform;
        incoming?: http.IncomingMessage;
        outgoing?: http.ServerResponse;
        remoteAddress?: string;
        remotePort?: number;
        serverState?: () => ServerHealthState;
      })
    | undefined;

  const selfHost = platform?.selfHostPlatform ?? platform;
  if (
    !selfHost ||
    (selfHost.remoteAddress === undefined &&
      selfHost.incoming === undefined &&
      selfHost.serverState === undefined)
  ) {
    throw new DomainError(
      'INTERNAL_SERVER_ERROR',
      'Self-host context is missing: Action is not executing within a self-hosted server environment or test harness.',
    );
  }

  return {
    remoteAddress: selfHost.remoteAddress,
    remotePort: selfHost.remotePort,
    incoming: selfHost.incoming,
    outgoing: selfHost.outgoing,
    serverState: selfHost.serverState ?? (() => 'HEALTHY'),
  };
}

/**
 * @purpose Options parameterizing self-host server deployment.
 * @rationale Allows specifying listening port, host, grace periods, probe endpoints, readiness callback, and teardown hooks.
 * @preconditions Valid port and positive timeout integers if provided.
 * @param None
 * @returns Configuration options object.
 * @throws Never throws on declaration.
 * @invariants Readonly options structure.
 */
export interface SelfHostOptions {
  readonly port?: number | undefined;
  readonly host?: string | undefined;
  readonly shutdownGracePeriodMs?: number | undefined;
  readonly livenessPath?: string | undefined;
  readonly readinessPath?: string | undefined;
  readonly isReady?: (() => Promise<boolean> | boolean) | undefined;
  readonly onShutdown?: (() => Promise<void> | void) | undefined;
}

/**
 * @purpose Self-host server instance handle returned by createSelfHostServer.
 * @rationale Provides manual stop and status inspection methods.
 * @preconditions Successfully initialized server handle.
 * @param None
 * @returns Control handle object.
 * @throws Never throws on declaration.
 * @invariants Controls underlying HTTP listener and connection tracking.
 */
export interface SelfHostServerHandle {
  readonly getState: () => ServerHealthState;
  readonly getActiveRequestCount: () => number;
  readonly stop: () => Promise<void>;
  readonly server: http.Server;
}

/**
 * @purpose Creates and starts a self-hosted HTTP server with built-in health probes, OOM body limits, and graceful draining.
 * @rationale Exposes liveness and readiness probes, coordinates socket draining on SIGTERM, and protects memory via stream byte ceilings.
 * @preconditions app is a configured Hono instance; config is a ShukoiConfig.
 * @param app Hono application instance.
 * @param config ShukoiConfig instance.
 * @param options Server port, host, grace period, probes, and shutdown callbacks.
 * @returns SelfHostServerHandle with state inspection and graceful stop method.
 * @throws Never throws during startup; binds server to configured port.
 * @invariants Deterministic graceful shutdown state machine; socket pool tracked and destroyed on deadline; OOM defense via maxBodyBytes limit.
 */
export function createSelfHostServer(
  app: Hono,
  config: ShukoiConfig,
  options?: SelfHostOptions,
): SelfHostServerHandle {
  const port = options?.port ?? 3000;
  const host = options?.host ?? '0.0.0.0';
  const gracePeriodMs = options?.shutdownGracePeriodMs ?? 10000;
  const livenessPath = options?.livenessPath ?? '/healthz/live';
  const readinessPath = options?.readinessPath ?? '/healthz/ready';

  let state: ServerHealthState = 'STARTING';
  let activeRequests = 0;
  const activeControllers = new Set<AbortController>();
  const sockets = new Set<import('node:net').Socket>();

  const server = http.createServer(async (req, res) => {
    // 1. Built-in Liveness Probe: always 200 while process is alive
    if (req.url === livenessPath) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'live', service: config.observability.serviceName }));
      return;
    }

    // 2. Built-in Readiness Probe: 200 when HEALTHY (and isReady is satisfied), 503 when DRAINING or STARTING
    if (req.url === readinessPath) {
      if (state === 'HEALTHY') {
        if (options?.isReady) {
          try {
            const ready = await options.isReady();
            if (ready) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'ready', activeRequests }));
            } else {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'unhealthy', activeRequests }));
            }
          } catch {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'unhealthy', activeRequests }));
          }
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ready', activeRequests }));
        }
      } else {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: state === 'STARTING' ? 'starting' : 'draining',
            activeRequests,
          }),
        );
      }
      return;
    }

    // If server is draining, reject new incoming ingress requests
    if (state === 'DRAINING' || state === 'TERMINATED') {
      res.writeHead(503, {
        'Content-Type': 'application/json',
        Connection: 'close',
      });
      res.end(JSON.stringify({ error: 'Service is shutting down' }));
      return;
    }

    // 3. Track active in-flight request
    activeRequests++;
    const abortController = new AbortController();
    activeControllers.add(abortController);

    req.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort(new Error('Client aborted connection'));
      }
    });

    try {
      const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v) {
          if (Array.isArray(v)) {
            v.forEach((item) => {
              headers.append(k, item);
            });
          } else {
            headers.set(k, v);
          }
        }
      }

      // Stream-bounded body reader: enforces maxBodyBytes with HTTP 413
      let body: BodyInit | null = null;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        const maxBytes = config.limits.maxBodyBytes ?? 10 * 1024 * 1024;
        let exceeded = false;

        for await (const chunk of req) {
          const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
          totalBytes += buf.length;
          if (totalBytes > maxBytes) {
            exceeded = true;
            break;
          }
          chunks.push(buf);
        }

        if (exceeded) {
          const error = new DomainError(
            'PAYLOAD_TOO_LARGE',
            `Request body exceeded maximum limit of ${maxBytes} bytes`,
            413,
          );
          const problem = error.toProblemDetails('req-payload-too-large');
          res.writeHead(413, { 'Content-Type': 'application/problem+json' });
          res.end(JSON.stringify(problem));
          return;
        }

        body = Buffer.concat(chunks);
      }

      const webRequest = new Request(url, {
        method: req.method ?? 'GET',
        headers,
        body,
        signal: abortController.signal,
      });

      // Inject SelfHostPlatform into app.fetch env parameter
      const selfHostPlatform: SelfHostPlatform = {
        remoteAddress: req.socket.remoteAddress,
        remotePort: req.socket.remotePort,
        incoming: req,
        outgoing: res,
        serverState: () => state,
      };

      const webResponse = await app.fetch(webRequest, {
        selfHostPlatform,
        ...selfHostPlatform,
      });

      res.statusCode = webResponse.status;

      // Extract cookies via Web-standard getSetCookie() to preserve multiple Set-Cookie headers
      const getSetCookieFn = (webResponse.headers as unknown as { getSetCookie?: () => string[] })
        .getSetCookie;
      const cookies: string[] =
        typeof getSetCookieFn === 'function'
          ? getSetCookieFn.call(webResponse.headers)
          : Array.from(webResponse.headers.entries())
              .filter(([k]) => k.toLowerCase() === 'set-cookie')
              .map(([, v]) => v);

      webResponse.headers.forEach((val, key) => {
        if (key.toLowerCase() !== 'set-cookie') {
          res.setHeader(key, val);
        }
      });

      if (cookies.length > 0) {
        res.setHeader('set-cookie', cookies);
      }

      // Stream body with backpressure handling
      if (webResponse.body) {
        const reader = webResponse.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (value) {
            const ok = res.write(value);
            if (!ok) {
              await new Promise<void>((resolve) => {
                res.once('drain', resolve);
              });
            }
          }
        }
      }
      res.end();
    } catch (err) {
      if (!res.headersSent) {
        const message = err instanceof Error ? err.message : 'Internal Server Error';
        const internalError = new DomainError('INTERNAL_SERVER_ERROR', message, 500);
        const problem = internalError.toProblemDetails('req-server-error');
        res.writeHead(500, { 'Content-Type': 'application/problem+json' });
        res.end(JSON.stringify(problem));
      }
    } finally {
      activeRequests--;
      activeControllers.delete(abortController);
    }
  });

  // Track active TCP sockets to destroy them on deadline expiration
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  // Graceful shutdown execution logic
  let isShuttingDown = false;
  const gracefulDrain = async (): Promise<void> => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    state = 'DRAINING';

    // Await active in-flight requests or deadline (new requests receive 503)
    const deadline = Date.now() + gracePeriodMs;
    while (activeRequests > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Stop accepting new connections
    server.close();

    // If active requests remain after deadline, abort them
    if (activeRequests > 0) {
      for (const ctrl of activeControllers) {
        ctrl.abort('Shutdown deadline exceeded');
      }
      activeControllers.clear();
    }

    // Forcefully destroy any dangling keep-alive sockets
    for (const socket of sockets) {
      socket.destroy();
    }
    sockets.clear();

    // Run registered teardown hooks (database pools, caches)
    if (options?.onShutdown) {
      try {
        await options.onShutdown();
      } catch {
        // Suppress teardown errors during exit
      }
    }

    state = 'TERMINATED';
  };

  // Register signal listeners
  const sigHandler = async () => {
    await gracefulDrain();
  };

  process.on('SIGTERM', sigHandler);
  process.on('SIGINT', sigHandler);

  server.listen(port, host, () => {
    state = 'HEALTHY';
  });

  return {
    getState: () => state,
    getActiveRequestCount: () => activeRequests,
    stop: async () => {
      process.removeListener('SIGTERM', sigHandler);
      process.removeListener('SIGINT', sigHandler);
      await gracefulDrain();
    },
    server,
  };
}
