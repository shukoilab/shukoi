/**
 * @purpose Self-Host runtime server adapter for Node.js and Bun with graceful shutdown state machine and health probes.
 * @rationale Implements container lifecycle probes (/healthz/live, /healthz/ready) and a deterministic graceful drain state machine on SIGTERM/SIGINT, preventing dropped requests during Kubernetes rolling deployments.
 * @preconditions Running in Node.js 22+ or Bun 1.2+ environment; app is a configured Hono instance.
 * @invariants Deterministic state transitions (HEALTHY -> DRAINING -> TERMINATED); 503 ready probe on drain; hard timeout deadline.
 */

import http from 'node:http';
import type { ShukoiConfig } from '@shukoi/core';
import type { Hono } from 'hono';

/**
 * @purpose Operational health state enumeration for self-host deployment.
 * @rationale Governs readiness probe status responses during process startup and teardown.
 * @invariants Readonly state machine enum.
 */
export type ServerHealthState = 'STARTING' | 'HEALTHY' | 'DRAINING' | 'TERMINATED';

/**
 * @purpose Options parameterizing self-host server deployment.
 * @rationale Allows specifying listening port, host, grace periods, and teardown hooks.
 * @invariants Readonly options structure.
 */
export interface SelfHostOptions {
  readonly port?: number | undefined;
  readonly host?: string | undefined;
  readonly shutdownGracePeriodMs?: number | undefined;
  readonly onShutdown?: (() => Promise<void> | void) | undefined;
}

/**
 * @purpose Self-host server instance handle returned by createSelfHostServer.
 * @rationale Provides manual stop and status inspection methods.
 * @invariants Controls underlying HTTP listener and connection tracking.
 */
export interface SelfHostServerHandle {
  readonly getState: () => ServerHealthState;
  readonly getActiveRequestCount: () => number;
  readonly stop: () => Promise<void>;
  readonly server: http.Server;
}

/**
 * @purpose Creates and starts a self-hosted HTTP server with built-in health probes and graceful draining.
 * @rationale Exposes /healthz/live (liveness) and /healthz/ready (readiness) and coordinates socket draining on SIGTERM.
 * @preconditions app is a configured Hono instance; config is a ShukoiConfig.
 * @param app Hono application instance.
 * @param config ShukoiConfig instance.
 * @param options Server port, host, grace period, and shutdown callbacks.
 * @returns SelfHostServerHandle with state inspection and graceful stop method.
 * @throws Never throws during startup; binds server to configured port.
 * @invariants Deterministic graceful shutdown state machine; socket pool tracked and destroyed on deadline.
 */
export function createSelfHostServer(
  app: Hono,
  config: ShukoiConfig,
  options?: SelfHostOptions,
): SelfHostServerHandle {
  const port = options?.port ?? 3000;
  const host = options?.host ?? '0.0.0.0';
  const gracePeriodMs = options?.shutdownGracePeriodMs ?? 10000;

  let state: ServerHealthState = 'STARTING';
  let activeRequests = 0;
  const activeControllers = new Set<AbortController>();
  const sockets = new Set<import('node:net').Socket>();

  const server = http.createServer(async (req, res) => {
    // 1. Built-in Liveness Probe: always 200 while process is alive
    if (req.url === '/healthz/live') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'live', service: config.observability.serviceName }));
      return;
    }

    // 2. Built-in Readiness Probe: 200 when HEALTHY, 503 when DRAINING or STARTING
    if (req.url === '/healthz/ready') {
      if (state === 'HEALTHY') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ready', activeRequests }));
      } else {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'draining', activeRequests }));
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

      let body: BodyInit | null = null;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        body = Buffer.concat(chunks);
      }

      const webRequest = new Request(url, {
        method: req.method ?? 'GET',
        headers,
        body,
        signal: abortController.signal,
      });

      const webResponse = await app.fetch(webRequest);

      res.statusCode = webResponse.status;
      webResponse.headers.forEach((val, key) => {
        res.setHeader(key, val);
      });

      if (webResponse.body) {
        const reader = webResponse.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (value) {
            res.write(value);
          }
        }
      }
      res.end();
    } catch (_err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
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
