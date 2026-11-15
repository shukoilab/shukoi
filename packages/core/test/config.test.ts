/**
 * @purpose Unit tests verifying ShukoiConfig schema validation, defaults, and immutability.
 * @rationale Ensures 12-factor configuration parameters fail-fast on malformed input and freeze runtime state.
 * @preconditions Vitest test runner.
 * @invariants Assertions must pass with exit code 0.
 */

import { describe, expect, it } from 'vitest';
import { createDefaultConfig, validateShukoiConfig } from '../src/config.js';
import { DomainError } from '../src/errors.js';

describe('ShukoiConfig', () => {
  it('creates default configuration with deeply frozen properties', () => {
    const config = createDefaultConfig();
    expect(config.security.jwtAllowedAlgorithms).toEqual(['RS256', 'EdDSA']);
    expect(config.limits.maxBodyBytes).toBe(10485760);
    expect(config.observability.logLevel).toBe('info');
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.security)).toBe(true);
    expect(Object.isFrozen(config.limits)).toBe(true);
  });

  it('validates raw configuration and rejects malformed objects', () => {
    expect(() => validateShukoiConfig(null)).toThrow(DomainError);
    expect(() => validateShukoiConfig({})).toThrow(DomainError);
    expect(() =>
      validateShukoiConfig({
        security: { jwtAllowedAlgorithms: [] },
        limits: {},
        observability: {},
      }),
    ).toThrow(DomainError);
  });

  it('accepts valid custom configuration overrides', () => {
    const config = validateShukoiConfig({
      security: {
        jwtAllowedAlgorithms: ['ES256'],
        jwksUri: 'https://auth.example.com/.well-known/jwks.json',
      },
      limits: {
        maxBodyBytes: 5242880,
        defaultTimeoutMs: 15000,
      },
      observability: {
        serviceName: 'custom-service',
        logLevel: 'debug',
      },
    });

    expect(config.security.jwtAllowedAlgorithms).toEqual(['ES256']);
    expect(config.limits.maxBodyBytes).toBe(5242880);
    expect(config.limits.defaultTimeoutMs).toBe(15000);
    expect(config.observability.serviceName).toBe('custom-service');
  });
});
