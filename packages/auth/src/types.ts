/**
 * @purpose Enterprise authentication and authorization type definitions for @shukoi/auth.
 * @rationale Defines pluggable strategy interfaces, session contracts, and RBAC/ABAC models.
 * @preconditions None.
 * @invariants Pure TypeScript interfaces and types; zero runtime overhead.
 */

import type { AuthResult } from '@shukoi/core';

/**
 * @purpose Pluggable authentication strategy interface.
 * @rationale Enables chaining multiple authentication mechanisms (Session, Bearer, API Key).
 * @invariants Pure interface; thread-safe across concurrent async evaluations.
 */
export interface AuthStrategy<TUser = unknown> {
  readonly name: string;
  authenticate(headers: Readonly<Record<string, string>>): Promise<AuthResult<TUser> | null>;
}

/**
 * @purpose Session data model stored in session stores.
 * @rationale Represents authenticated session claims, expiration, and user metadata.
 * @invariants Timestamp-based expiration; immutable claims structure.
 */
export interface SessionData<TUser = unknown> {
  readonly sessionId: string;
  readonly user: Readonly<TUser>;
  readonly scopes: readonly string[];
  readonly expiresAt: number;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * @purpose Storage abstraction for stateful session persistence.
 * @rationale Pluggable store interface supporting in-memory LRU, Redis, or KV.
 * @invariants Asynchronous get/set/destroy; thread-safe.
 */
export interface SessionStore<TUser = unknown> {
  get(sessionId: string): Promise<SessionData<TUser> | null>;
  set(sessionId: string, data: SessionData<TUser>, ttlMs: number): Promise<void>;
  destroy(sessionId: string): Promise<void>;
}

/**
 * @purpose Storage abstraction for hashed API keys.
 * @rationale Binds SHA-256 hashed API key tokens to user profiles and permission scopes.
 * @invariants Constant-time lookup; thread-safe.
 */
export interface ApiKeyStore<TUser = unknown> {
  findByKeyHash(
    keyHash: string,
  ): Promise<{ user: Readonly<TUser>; scopes: readonly string[] } | null>;
}

/**
 * @purpose Configuration options for JWKS OAuth2 strategy.
 * @rationale Configures remote JWKS URL, allowed algorithms, issuer, audience, and cache TTL.
 * @invariants Strict algorithm pinning required.
 */
export interface JwksStrategyConfig {
  readonly jwksUri: string;
  readonly allowedAlgorithms: readonly string[];
  readonly issuer?: string | undefined;
  readonly audience?: string | undefined;
  readonly cacheTtlMs?: number | undefined;
  readonly fetchTimeoutMs?: number | undefined;
}

/**
 * @purpose Configuration options for Hashed API Key strategy.
 * @rationale Configures custom header name and backing ApiKeyStore or static key map.
 * @invariants SHA-256 hashed token lookup.
 */
export interface HashedApiKeyStrategyConfig<TUser = unknown> {
  readonly apiKeyHeaderName?: string | undefined;
  readonly store?: ApiKeyStore<TUser> | undefined;
  readonly staticKeys?:
    | Readonly<Record<string, { user: TUser; scopes?: readonly string[] }>>
    | undefined;
}

/**
 * @purpose Configuration options for Session Cookie strategy.
 * @rationale Configures cryptographic HMAC-SHA256 signing secret, cookie name, and session store.
 * @invariants Minimum 32-character secret recommended; Web Crypto HMAC.
 */
export interface SessionCookieStrategyConfig<TUser = unknown> {
  readonly secret: string;
  readonly cookieName?: string | undefined;
  readonly store: SessionStore<TUser>;
  readonly rollingTtlMs?: number | undefined;
}

/**
 * @purpose Configuration options for RFC 7662 OAuth 2.0 Token Introspection strategy.
 * @rationale Connects to centralized identity providers for real-time opaque token verification.
 * @invariants In-flight coalescing; short-lived TTL caching.
 */
export interface OidcIntrospectionStrategyConfig {
  readonly introspectionUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly cacheTtlMs?: number | undefined;
  readonly fetchTimeoutMs?: number | undefined;
}
