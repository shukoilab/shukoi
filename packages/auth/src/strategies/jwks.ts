/**
 * @purpose Multi-tenant JWKS OAuth2 Bearer token authentication strategy.
 * @rationale Implements Single-Flight Mutex pattern and strict algorithm pinning for JWT verification.
 * @preconditions JwksStrategyConfig specifying jwksUri and allowedAlgorithms.
 * @invariants Pure Web Crypto primitives; Single-Flight Mutex pattern; thread-safe across concurrent requests.
 */

import type { AuthResult } from '@shukoi/core';
import { DomainError } from '@shukoi/core';
import * as jose from 'jose';
import type { AuthStrategy, JwksStrategyConfig } from '../types.js';

/**
 * @purpose Creates an AuthStrategy verifying JWT tokens against a JWKS endpoint.
 * @rationale Shields authorization server from cache stampedes under high concurrency.
 * @param config Strategy configuration.
 * @returns AuthStrategy instance.
 * @throws Never throws during factory invocation.
 * @invariants O(1) cache hits; coalesced in-flight fetch on miss.
 */
export function createJwksStrategy<TUser = unknown>(
  config: JwksStrategyConfig,
): AuthStrategy<TUser> {
  let cachedJwks: jose.JSONWebKeySet | null = null;
  let cacheExpiresAt = 0;
  let inFlightPromise: Promise<jose.JSONWebKeySet> | null = null;

  const cacheTtlMs = config.cacheTtlMs ?? 300_000; // 5 minutes default
  const timeoutMs = config.fetchTimeoutMs ?? 5000;

  async function getJwks(): Promise<jose.JSONWebKeySet> {
    const now = Date.now();
    if (cachedJwks && now < cacheExpiresAt) {
      return cachedJwks;
    }
    if (inFlightPromise) {
      return inFlightPromise;
    }

    inFlightPromise = (async () => {
      try {
        const signal = AbortSignal.timeout(timeoutMs);
        const res = await fetch(config.jwksUri, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal,
        });

        if (!res.ok) {
          throw new DomainError(
            'SERVICE_UNAVAILABLE',
            `Failed to fetch JWKS: HTTP ${res.status}`,
            503,
          );
        }

        const data = (await res.json()) as jose.JSONWebKeySet;
        cachedJwks = data;
        cacheExpiresAt = Date.now() + cacheTtlMs;
        return data;
      } finally {
        inFlightPromise = null;
      }
    })();

    return inFlightPromise;
  }

  return {
    name: 'jwks',
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

      try {
        const jwks = await getJwks();
        const localJwkSet = jose.createLocalJWKSet(jwks);

        const verifyOptions: jose.JWTVerifyOptions = {
          algorithms: [...config.allowedAlgorithms],
        };
        if (config.issuer) {
          verifyOptions.issuer = config.issuer;
        }
        if (config.audience) {
          verifyOptions.audience = config.audience;
        }

        const { payload } = await jose.jwtVerify(token, localJwkSet, verifyOptions);

        const scopes = new Set<string>();
        if (typeof payload['scope'] === 'string') {
          for (const s of payload['scope'].split(' ')) {
            scopes.add(s);
          }
        } else if (Array.isArray(payload['scopes'])) {
          for (const s of payload['scopes']) {
            scopes.add(String(s));
          }
        }

        return {
          user: payload as unknown as Readonly<TUser>,
          scopes: Object.freeze(scopes),
          token,
        };
      } catch (err) {
        if (err instanceof DomainError) {
          throw err;
        }
        throw new DomainError(
          'UNAUTHORIZED',
          `JWT verification failed: ${err instanceof Error ? err.message : String(err)}`,
          401,
        );
      }
    },
  };
}
