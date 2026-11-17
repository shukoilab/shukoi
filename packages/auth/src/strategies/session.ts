/**
 * @purpose Cryptographically signed HMAC-SHA256 session cookie authentication strategy.
 * @rationale Provides tamper-proof stateful web sessions with rolling expiration and constant-time signature verification.
 * @preconditions SessionCookieStrategyConfig specifying signing secret and SessionStore.
 * @invariants Pure Web Crypto primitives; constant-time verification; zero memory leaks.
 */

import type { AuthResult } from '@shukoi/core';
import { DomainError, safeCompareSecrets } from '@shukoi/core';
import type { AuthStrategy, SessionCookieStrategyConfig } from '../types.js';

/**
 * @purpose Derives an HMAC-SHA256 CryptoKey from a string secret.
 * @param secret UTF-8 secret string.
 * @returns CryptoKey instance for signing and verifying.
 * @invariants Uses Web Crypto subtle API.
 */
async function getHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * @purpose Signs a session identifier using HMAC-SHA256.
 * @rationale Produces a tamper-proof value in the format `<sessionId>.<base64Signature>`.
 * @param sessionId Raw session ID string.
 * @param secret Cryptographic secret string.
 * @returns Signed cookie value string.
 * @invariants Deterministic signature for identical inputs.
 */
export async function signSessionCookie(sessionId: string, secret: string): Promise<string> {
  const key = await getHmacKey(secret);
  const enc = new TextEncoder();
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(sessionId));
  const signatureBytes = new Uint8Array(signatureBuffer);
  const signatureHex = Array.from(signatureBytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${sessionId}.${signatureHex}`;
}

/**
 * @purpose Verifies a signed session cookie value and extracts the session ID.
 * @rationale Validates signature using constant-time comparison to prevent tampering and timing leaks.
 * @param signedValue Value from Cookie header `<sessionId>.<signature>`.
 * @param secret Cryptographic secret string.
 * @returns Validated session ID string, or null if tampered or malformed.
 * @invariants Constant-time signature comparison.
 */
export async function verifySessionCookie(
  signedValue: string,
  secret: string,
): Promise<string | null> {
  const dotIndex = signedValue.lastIndexOf('.');
  if (dotIndex === -1) {
    return null;
  }

  const sessionId = signedValue.slice(0, dotIndex);
  const providedSignature = signedValue.slice(dotIndex + 1);

  const expectedSigned = await signSessionCookie(sessionId, secret);
  const expectedSignature = expectedSigned.slice(sessionId.length + 1);

  const isValid = await safeCompareSecrets(providedSignature, expectedSignature);
  return isValid ? sessionId : null;
}

/**
 * @purpose Parses a specific cookie value by name from raw Cookie header string.
 * @param cookieHeader Raw header value (e.g. `foo=bar; session=abc`).
 * @param cookieName Name of the cookie to locate.
 * @returns Cookie value string or null if not found.
 */
function parseCookieValue(cookieHeader: string, cookieName: string): string | null {
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${cookieName}=`)) {
      return trimmed.slice(cookieName.length + 1).trim();
    }
  }
  return null;
}

/**
 * @purpose Creates an AuthStrategy verifying HMAC-signed session cookies against a SessionStore.
 * @param config Strategy configuration parameters.
 * @returns AuthStrategy instance.
 * @invariants Validates signature before accessing storage layer; enforces expiration timestamps.
 */
export function createSessionCookieStrategy<TUser = unknown>(
  config: SessionCookieStrategyConfig<TUser>,
): AuthStrategy<TUser> {
  const cookieName = config.cookieName ?? 'shukoi_session';

  return {
    name: 'session',
    async authenticate(
      headers: Readonly<Record<string, string>>,
    ): Promise<AuthResult<TUser> | null> {
      const cookieHeader = headers['cookie'] ?? headers['Cookie'];
      if (!cookieHeader) {
        return null;
      }

      const signedValue = parseCookieValue(cookieHeader, cookieName);
      if (!signedValue) {
        return null;
      }

      const sessionId = await verifySessionCookie(signedValue, config.secret);
      if (!sessionId) {
        throw new DomainError('UNAUTHORIZED', 'Invalid or tampered session cookie', 401);
      }

      const session = await config.store.get(sessionId);
      if (!session) {
        throw new DomainError('UNAUTHORIZED', 'Session not found or expired', 401);
      }

      if (session.expiresAt <= Date.now()) {
        await config.store.destroy(sessionId);
        throw new DomainError('UNAUTHORIZED', 'Session expired', 401);
      }

      // Rolling session update if configured
      if (config.rollingTtlMs && config.rollingTtlMs > 0) {
        const refreshed: typeof session = {
          ...session,
          expiresAt: Date.now() + config.rollingTtlMs,
        };
        await config.store.set(sessionId, refreshed, config.rollingTtlMs);
      }

      const scopes = new Set<string>(session.scopes);
      return {
        user: session.user,
        scopes: Object.freeze(scopes),
        token: sessionId,
      };
    },
  };
}
