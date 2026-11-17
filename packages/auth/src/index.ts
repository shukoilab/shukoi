/**
 * @purpose Enterprise Authentication and RBAC/ABAC Authorization for Shukoi.
 * @rationale Composably resolves caller identity across multiple strategies and enforces granular declarative action authorization.
 * @preconditions Configured AuthStrategy instances.
 * @invariants Pure Web standards; Big-O O(S) where S is active strategies count; zero memory leaks.
 */

import type { AuthResult } from '@shukoi/core';
import type { AuthStrategy } from './types.js';

export * from './guard.js';
export * from './strategies/api-key.js';
export * from './strategies/jwks.js';
export * from './strategies/oidc.js';
export * from './strategies/session.js';
export * from './testing.js';
export * from './types.js';

/**
 * @purpose Creates a composite authentication resolver function chaining multiple strategies.
 * @rationale Evaluates strategies in deterministic priority order (e.g. Session -> Bearer -> ApiKey).
 * @param strategies Ordered array of AuthStrategy implementations.
 * @returns Async function accepting headers and resolving to AuthResult.
 * @throws DomainError('UNAUTHORIZED', 401) on invalid credentials.
 */
export function createCompositeAuthResolver<TUser = unknown>(
  strategies: readonly AuthStrategy<TUser>[],
): (headers: Readonly<Record<string, string>>) => Promise<AuthResult<TUser>> {
  return async (headers: Readonly<Record<string, string>>): Promise<AuthResult<TUser>> => {
    for (const strategy of strategies) {
      const result = await strategy.authenticate(headers);
      if (result !== null) {
        return result;
      }
    }

    return {
      user: null,
      scopes: Object.freeze(new Set<string>()),
    };
  };
}
