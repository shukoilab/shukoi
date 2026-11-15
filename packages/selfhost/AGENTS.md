# @shukoi/selfhost Package Constitution

## Local Scope & Boundaries

`@shukoi/selfhost` provides standalone HTTP server hosting on Bun 1.2+ and Node.js 22+ with container lifecycle probes and graceful connection draining.

### Invariants & Non-Negotiable Rules

1. **Container Probes:**
   - `/healthz/live`: Always returns 200 while process is alive.
   - `/healthz/ready`: Returns 200 when HEALTHY, and flips to 503 immediately when DRAINING.
2. **Graceful Drain State Machine:**
   - Intercepts `SIGTERM` and `SIGINT`.
   - Flips state to `DRAINING` (503 on ready probe, new requests receive 503).
   - Awaits in-flight requests up to `shutdownGracePeriodMs`.
   - Stops socket listener, aborts remaining active controllers on deadline, destroys dangling keep-alive sockets, executes `onShutdown()`, and exits code 0.
