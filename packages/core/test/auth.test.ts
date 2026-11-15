/**
 * @purpose Unit tests for constant-time secret comparison, Single-Flight JWKS client, and token auth.
 * @rationale Validates single-flight concurrency mutex and timing-attack defense.
 * @preconditions Vitest test runner.
 * @invariants Assertions must pass with exit code 0.
 */

import { describe, expect, it, vi } from 'vitest';
import { resolveAuth, SingleFlightJwksClient, safeCompareSecrets } from '../src/auth.js';
import { createDefaultConfig } from '../src/config.js';
import { DomainError } from '../src/errors.js';

describe('Auth & Single-Flight JWKS', () => {
  it('correctly compares secrets in constant time', async () => {
    expect(await safeCompareSecrets('secret-key-1', 'secret-key-1')).toBe(true);
    expect(await safeCompareSecrets('secret-key-1', 'secret-key-2')).toBe(false);
    expect(await safeCompareSecrets('short', 'much-longer-string')).toBe(false);
    expect(await safeCompareSecrets('', '')).toBe(true);
  });

  it('coalesces concurrent JWKS requests into a single network fetch via single-flight mutex', async () => {
    const config = createDefaultConfig({
      security: {
        jwksUri: 'https://auth.example.com/.well-known/jwks.json',
        jwksFetchTimeoutMs: 2000,
        jwksCacheTtlMs: 5000,
      },
    });

    let fetchCount = 0;
    const mockJwks = { keys: [{ kty: 'RSA', kid: 'key-1' }] };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      fetchCount++;
      // Simulate network latency
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        ok: true,
        status: 200,
        json: async () => mockJwks,
      } as unknown as Response;
    });

    const client = new SingleFlightJwksClient(config.security);

    // Fire 50 concurrent calls
    const results = await Promise.all(Array.from({ length: 50 }, () => client.getJwks()));

    expect(fetchCount).toBe(1);
    expect(results.length).toBe(50);
    expect(results[0]).toEqual(mockJwks);

    vi.restoreAllMocks();
  });

  it('authenticates via static API keys with constant-time matching', async () => {
    const config = createDefaultConfig();
    const staticKeys = { 'test-api-key-999': { id: 'admin-1', role: 'admin' } };

    const validResult = await resolveAuth(
      { 'x-api-key': 'test-api-key-999' },
      config.security,
      undefined,
      staticKeys,
    );
    expect(validResult.user).toEqual({ id: 'admin-1', role: 'admin' });
    expect(validResult.scopes.has('*')).toBe(true);

    await expect(
      resolveAuth({ 'x-api-key': 'wrong-key' }, config.security, undefined, staticKeys),
    ).rejects.toThrow(DomainError);
  });
});
