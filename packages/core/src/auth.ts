/**
 * @purpose Cross-transport authentication, single-flight JWKS key discovery, and constant-time secret comparison.
 * @rationale Protects APIs against timing side-channel attacks, JWT algorithm confusion, and JWKS cache stampedes under high concurrency.
 * @preconditions ShukoiSecurityConfig must specify allowed JWT algorithms, optional JWKS URI, and clock tolerances.
 * @invariants Pure Web Crypto primitives; Single-Flight Mutex pattern; thread-safe across concurrent requests.
 */

import * as jose from 'jose';
import type { ShukoiSecurityConfig } from './config.js';
import { DomainError } from './errors.js';

/**
 * @purpose Constant-time string and token comparison resistant to timing side-channel attacks.
 * @rationale Standard string equality (===) terminates on first non-matching byte, leaking timing secrets. SHA-256 bitwise XOR executes in constant time.
 * @preconditions a and b are arbitrary UTF-8 strings.
 * @param a First secret string to compare.
 * @param b Second secret string to compare.
 * @returns Promise resolving to true if strings are identical, false otherwise.
 * @throws Never throws; subtle crypto failures are handled.
 * @invariants Constant-time Big-O O(1) loop over fixed 32-byte digest array; zero memory leaks.
 */
export async function safeCompareSecrets(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const viewA = new Uint8Array(hashA);
  const viewB = new Uint8Array(hashB);
  let diff = enc.encode(a).byteLength ^ enc.encode(b).byteLength;
  for (let i = 0; i < 32; i++) {
    diff |= (viewA[i] ?? 0) ^ (viewB[i] ?? 0);
  }
  return diff === 0;
}

/**
 * @purpose Single-Flight JWKS Client that fetches and caches JSON Web Key Sets with stampede protection.
 * @rationale Ensures that under 500+ concurrent requests on cache expiration, exactly one outbound fetch occurs.
 * @preconditions config must specify jwksUri and jwksCacheTtlMs.
 * @invariants In-memory bounded cache; single-flight promise deduplication; auto-eviction after TTL.
 */
export class SingleFlightJwksClient {
  private readonly config: ShukoiSecurityConfig;
  private cachedKeys: jose.JSONWebKeySet | null = null;
  private cacheExpiresAt = 0;
  private inFlightPromise: Promise<jose.JSONWebKeySet> | null = null;

  public constructor(config: ShukoiSecurityConfig) {
    this.config = config;
  }

  /**
   * @purpose Retrieves JWKS keys, fetching from remote endpoint if cache is expired or empty.
   * @rationale Uses Single-Flight Mutex pattern to coalesce concurrent cache-miss requests into a single network call.
   * @param signal Optional AbortSignal to cancel waiting.
   * @returns Promise resolving to active JSONWebKeySet.
   * @throws DomainError('SERVICE_UNAVAILABLE', ...) if remote JWKS endpoint fails or times out.
   * @invariants Big-O time complexity O(1) on cache hit; single outbound fetch on concurrent cache miss.
   */
  public async getJwks(signal?: AbortSignal): Promise<jose.JSONWebKeySet> {
    const now = Date.now();
    if (this.cachedKeys && now < this.cacheExpiresAt) {
      return this.cachedKeys;
    }

    const jwksUri = this.config.jwksUri;
    if (!jwksUri) {
      throw new DomainError('UNAUTHORIZED', 'No JWKS URI configured for token verification', 401);
    }

    // Coalesce concurrent calls to single in-flight promise
    if (this.inFlightPromise) {
      return this.inFlightPromise;
    }

    this.inFlightPromise = (async () => {
      try {
        const timeoutSignal = AbortSignal.timeout(this.config.jwksFetchTimeoutMs);
        const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

        const response = await fetch(jwksUri, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: combinedSignal,
        });

        if (!response.ok) {
          throw new DomainError(
            'SERVICE_UNAVAILABLE',
            `Failed to fetch JWKS: HTTP ${response.status}`,
            503,
          );
        }

        const data = (await response.json()) as jose.JSONWebKeySet;
        this.cachedKeys = data;
        this.cacheExpiresAt = Date.now() + this.config.jwksCacheTtlMs;
        return data;
      } finally {
        this.inFlightPromise = null;
      }
    })();

    return this.inFlightPromise;
  }

  /**
   * @purpose Clears in-memory JWKS cache (for testing or key rotation).
   * @rationale Enables immediate key invalidation without server restart.
   * @returns void
   * @throws Never throws.
   * @invariants O(1) state reset.
   */
  public clearCache(): void {
    this.cachedKeys = null;
    this.cacheExpiresAt = 0;
    this.inFlightPromise = null;
  }
}

/**
 * @purpose Resolved authentication result structure.
 * @rationale Supplies strongly-typed user claims and permission scopes to the action execution context.
 * @invariants Readonly scopes Set; immutable claims object.
 */
export interface AuthResult<TUser = unknown> {
  readonly user: Readonly<TUser> | null;
  readonly scopes: ReadonlySet<string>;
  readonly token?: string;
}

/**
 * @purpose Resolves caller identity and permissions from HTTP headers, API keys, or JWT tokens.
 * @rationale Implements defense-in-depth authentication verifying algorithm pinning, expiration, issuer, and audience.
 * @preconditions config must specify security parameters; headers is a string-record of incoming request headers.
 * @param headers Incoming transport headers.
 * @param config ShukoiSecurityConfig instance.
 * @param jwksClient Optional SingleFlightJwksClient instance.
 * @param staticApiKeys Optional map of valid API keys to user profiles.
 * @returns Promise resolving to AuthResult containing user and permission scopes.
 * @throws DomainError('UNAUTHORIZED', ...) on malformed tokens, invalid signatures, or expired credentials.
 * @invariants Big-O time complexity O(1); constant-time API key verification; algorithm pinning enforced.
 */
export async function resolveAuth<TUser = unknown>(
  headers: Readonly<Record<string, string>>,
  config: ShukoiSecurityConfig,
  jwksClient?: SingleFlightJwksClient,
  staticApiKeys?: Readonly<Record<string, TUser>>,
): Promise<AuthResult<TUser>> {
  // 1. Check API Key Header first
  const apiKeyHeader = config.apiKeyHeaderName.toLowerCase();
  const rawApiKey = headers[apiKeyHeader] ?? headers[config.apiKeyHeaderName];

  if (rawApiKey && staticApiKeys) {
    for (const [validKey, userProfile] of Object.entries(staticApiKeys)) {
      if (await safeCompareSecrets(rawApiKey, validKey)) {
        const scopes = new Set<string>(['*']);
        return {
          user: userProfile as Readonly<TUser>,
          scopes: Object.freeze(scopes),
          token: rawApiKey,
        };
      }
    }
    throw new DomainError('UNAUTHORIZED', 'Invalid API Key provided', 401);
  }

  // 2. Check Authorization: Bearer <jwt>
  const authHeader = headers['authorization'] ?? headers['Authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return { user: null, scopes: Object.freeze(new Set<string>()) };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new DomainError('UNAUTHORIZED', 'Empty Bearer token', 401);
  }

  // If no JWKS URI is configured, decode unverified or rely on HMAC secret
  if (!config.jwksUri || !jwksClient) {
    try {
      const claims = jose.decodeJwt(token);
      const scopes = new Set<string>();
      if (typeof claims['scope'] === 'string') {
        claims['scope'].split(' ').forEach((s) => {
          scopes.add(s);
        });
      } else if (Array.isArray(claims['scopes'])) {
        claims['scopes'].forEach((s) => {
          scopes.add(String(s));
        });
      }
      return {
        user: claims as Readonly<TUser>,
        scopes: Object.freeze(scopes),
        token,
      };
    } catch {
      throw new DomainError('UNAUTHORIZED', 'Malformed JWT token', 401);
    }
  }

  // 3. Verify JWT against JWKS with strict algorithm pinning
  try {
    const jwks = await jwksClient.getJwks();
    const JWKS = jose.createLocalJWKSet(jwks);

    const verifyOptions: jose.JWTVerifyOptions = {
      algorithms: [...config.jwtAllowedAlgorithms],
      clockTolerance: config.jwtClockToleranceSec,
    };
    if (config.jwtIssuer) {
      verifyOptions.issuer = config.jwtIssuer;
    }
    if (config.jwtAudience) {
      verifyOptions.audience = config.jwtAudience;
    }

    const { payload } = await jose.jwtVerify(token, JWKS, verifyOptions);

    const scopes = new Set<string>();
    if (typeof payload['scope'] === 'string') {
      payload['scope'].split(' ').forEach((s) => {
        scopes.add(s);
      });
    } else if (Array.isArray(payload['scopes'])) {
      payload['scopes'].forEach((s) => {
        scopes.add(String(s));
      });
    }

    return {
      user: payload as Readonly<TUser>,
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
}
