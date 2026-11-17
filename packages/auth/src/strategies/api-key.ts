/**
 * @purpose Enterprise Hashed API Key authentication strategy.
 * @rationale Implements constant-time SHA-256 token verification resistant to timing attacks and database key exposure.
 * @preconditions HashedApiKeyStrategyConfig specifying store or static keys.
 * @invariants Pure Web Crypto primitives; constant-time comparison; zero memory leaks.
 */

import type { AuthResult } from '@shukoi/core';
import { DomainError } from '@shukoi/core';
import type { AuthStrategy, HashedApiKeyStrategyConfig } from '../types.js';

/**
 * @purpose Computes a SHA-256 hex digest for an API key token.
 * @param apiKey Raw secret API key string.
 * @returns 64-character lowercase hex digest string.
 * @invariants Deterministic cryptographic hash.
 */
export async function hashApiKey(apiKey: string): Promise<string> {
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(apiKey));
  const bytes = new Uint8Array(hashBuffer);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @purpose Creates an AuthStrategy verifying API keys against a store or static key registry.
 * @param config Strategy configuration parameters.
 * @returns AuthStrategy instance.
 * @invariants Constant-time verification; Big-O O(1) lookup.
 */
export function createHashedApiKeyStrategy<TUser = unknown>(
  config: HashedApiKeyStrategyConfig<TUser>,
): AuthStrategy<TUser> {
  const headerName = (config.apiKeyHeaderName ?? 'x-api-key').toLowerCase();

  // Pre-hash static keys at factory initialization to guarantee O(1) constant-time lookup
  const staticKeyHashesPromise: Promise<
    Map<string, { user: unknown; scopes?: readonly string[] }>
  > = (async () => {
    const map = new Map<string, { user: unknown; scopes?: readonly string[] }>();
    if (config.staticKeys) {
      for (const [validKey, profile] of Object.entries(config.staticKeys)) {
        const hash = await hashApiKey(validKey.trim());
        map.set(hash, profile);
      }
    }
    return map;
  })();

  return {
    name: 'api-key',
    async authenticate(
      headers: Readonly<Record<string, string>>,
    ): Promise<AuthResult<TUser> | null> {
      const rawApiKey = headers[headerName] ?? headers[config.apiKeyHeaderName ?? 'x-api-key'];
      if (!rawApiKey || typeof rawApiKey !== 'string' || rawApiKey.trim().length === 0) {
        return null;
      }

      const trimmedKey = rawApiKey.trim();
      const keyHash = await hashApiKey(trimmedKey);

      // 1. Check dynamic ApiKeyStore if configured
      if (config.store) {
        const record = await config.store.findByKeyHash(keyHash);
        if (!record) {
          throw new DomainError('UNAUTHORIZED', 'Invalid API Key provided', 401);
        }

        const scopes = new Set<string>(record.scopes);
        return {
          user: record.user,
          scopes: Object.freeze(scopes),
          token: trimmedKey,
        };
      }

      // 2. Check static keys map via O(1) constant-time pre-hashed lookup
      if (config.staticKeys) {
        const staticMap = await staticKeyHashesPromise;
        const profile = staticMap.get(keyHash);
        if (profile) {
          const scopes = new Set<string>(profile.scopes ?? ['*']);
          return {
            user: profile.user as Readonly<TUser>,
            scopes: Object.freeze(scopes),
            token: trimmedKey,
          };
        }
        throw new DomainError('UNAUTHORIZED', 'Invalid API Key provided', 401);
      }

      return null;
    },
  };
}
