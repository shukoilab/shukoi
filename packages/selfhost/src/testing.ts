/**
 * @purpose In-memory testing mocks and factories for self-host runtime platform context.
 * @rationale Enables ultra-fast unit and integration testing of self-hosted Shukoi actions in Vitest without binding live OS network sockets.
 * @preconditions Vitest or Web-Standard test runner; pure JavaScript runtime.
 * @invariants Pure in-memory state; deterministic fixtures; zero external network dependencies.
 */

import type { SelfHostPlatform, ServerHealthState } from './index.js';

/**
 * @purpose Factory for lightweight in-memory SelfHostPlatform test double.
 * @rationale Allows actions and middleware depending on client IP, port, or server status to be tested in pure Vitest in 1ms.
 * @preconditions Optional partial overrides for SelfHostPlatform properties.
 * @param overrides Partial properties to customize remoteAddress, remotePort, or serverState.
 * @returns Instantiated SelfHostPlatform test double.
 * @throws Never throws on instantiation.
 * @invariants Deterministic default values; serverState returns 'HEALTHY' by default.
 */
export function createMockSelfHostContext(overrides?: Partial<SelfHostPlatform>): SelfHostPlatform {
  const state: ServerHealthState = overrides?.serverState ? overrides.serverState() : 'HEALTHY';

  return {
    remoteAddress: overrides?.remoteAddress ?? '127.0.0.1',
    remotePort: overrides?.remotePort ?? 54321,
    incoming: overrides?.incoming,
    outgoing: overrides?.outgoing,
    serverState: overrides?.serverState ?? (() => state),
  };
}
