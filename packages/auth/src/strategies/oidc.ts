/**
 * @purpose RFC 7662 OAuth 2.0 Token Introspection authentication strategy.
 * @rationale Validates opaque access tokens against centralized enterprise identity providers with in-flight coalescing.
 * @preconditions OidcIntrospectionStrategyConfig specifying introspectionUrl and client credentials.
 * @invariants Pure Web standards; Single-Flight Mutex pattern; thread-safe across concurrent requests.
 */

import type { AuthResult } from '@shukoi/core';
import { DomainError } from '@shukoi/core';
import { BoundedLruCache } from '../lru.js';
import type { AuthStrategy, OidcIntrospectionStrategyConfig } from '../types.js';

/**
 * @purpose Encodes HTTP Basic credentials safely handling UTF-8 characters without Latin-1 errors.
 * @rationale Avoids btoa Latin-1 limitation by encoding UTF-8 byte sequences prior to Base64 serialization.
 * @preconditions username and secret must be strings.
 * @param username Client identifier string.
 * @param secret Client secret string.
 * @returns RFC 7617 compatible Base64 credentials string.
 * @throws Never throws.
 * @invariants Big-O O(L) where L is credential character length.
 */
function encodeBasicAuth(username: string, secret: string): string {
  const bytes = new TextEncoder().encode(`${username}:${secret}`);
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

/**
 * @purpose Standard RFC 7662 introspection response structure.
 */
interface IntrospectionPayload {
  active: boolean;
  scope?: string;
  client_id?: string;
  sub?: string;
  exp?: number;
  [key: string]: unknown;
}

/**
 * @purpose Creates an AuthStrategy verifying opaque Bearer tokens via RFC 7662 Token Introspection.
 * @param config Strategy configuration.
 * @returns AuthStrategy instance.
 */
export function createOidcIntrospectionStrategy<TUser = unknown>(
  config: OidcIntrospectionStrategyConfig,
): AuthStrategy<TUser> {
  const cacheTtlMs = config.cacheTtlMs ?? 60_000;
  const timeoutMs = config.fetchTimeoutMs ?? 5000;

  const cache = new BoundedLruCache<string, { result: AuthResult<TUser>; expiresAt: number }>(5000);
  const inFlight = new Map<string, Promise<AuthResult<TUser>>>();

  async function introspectToken(token: string): Promise<AuthResult<TUser>> {
    const now = Date.now();
    const cached = cache.get(token);
    if (cached && now < cached.expiresAt) {
      return cached.result;
    }

    const running = inFlight.get(token);
    if (running) {
      return running;
    }

    const promise = (async () => {
      try {
        const signal = AbortSignal.timeout(timeoutMs);
        const credentials = encodeBasicAuth(config.clientId, config.clientSecret);

        const body = new URLSearchParams({ token, token_type_hint: 'access_token' });
        const res = await fetch(config.introspectionUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            Authorization: `Basic ${credentials}`,
          },
          body: body.toString(),
          signal,
        });

        if (!res.ok) {
          throw new DomainError(
            'SERVICE_UNAVAILABLE',
            `Introspection endpoint returned HTTP ${res.status}`,
            503,
          );
        }

        const data = (await res.json()) as IntrospectionPayload;
        if (!data.active) {
          throw new DomainError('UNAUTHORIZED', 'Access token is inactive or revoked', 401);
        }

        const scopes = new Set<string>();
        if (typeof data.scope === 'string') {
          for (const s of data.scope.split(' ')) {
            scopes.add(s);
          }
        }

        const result: AuthResult<TUser> = {
          user: data as unknown as Readonly<TUser>,
          scopes: Object.freeze(scopes),
          token,
        };

        cache.set(token, { result, expiresAt: Date.now() + cacheTtlMs });
        return result;
      } finally {
        inFlight.delete(token);
      }
    })();

    inFlight.set(token, promise);
    return promise;
  }

  return {
    name: 'oidc-introspection',
    async authenticate(
      headers: Readonly<Record<string, string>>,
    ): Promise<AuthResult<TUser> | null> {
      const authHeader = headers['authorization'] ?? headers['Authorization'];
      if (!authHeader?.startsWith('Bearer ')) {
        return null;
      }

      const token = authHeader.slice(7).trim();
      if (!token) {
        throw new DomainError('UNAUTHORIZED', 'Empty Bearer token provided', 401);
      }

      return await introspectToken(token);
    },
  };
}
