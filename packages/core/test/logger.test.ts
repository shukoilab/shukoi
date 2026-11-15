/**
 * @purpose Unit tests for zero-dependency structured logger, path redaction, and circular reference safety.
 * @rationale Ensures stdout sterility is preserved and sensitive credentials are never leaked into logs.
 * @preconditions Vitest test runner.
 * @invariants Assertions must pass with exit code 0.
 */

import { describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../src/config.js';
import { createShukoiLogger, safeJsonStringify } from '../src/logger.js';

describe('Sterile ShukoiLogger', () => {
  it('redacts sensitive fields configured in redactPaths', () => {
    const raw = {
      username: 'user1',
      password: 'superSecretPassword',
      token: 'jwt-123',
      nested: {
        authorization: 'Bearer token',
        score: 100,
      },
    };

    const serialized = safeJsonStringify(raw, ['password', 'token', 'authorization']);
    const parsed = JSON.parse(serialized);

    expect(parsed.username).toBe('user1');
    expect(parsed.password).toBe('[REDACTED]');
    expect(parsed.token).toBe('[REDACTED]');
    expect(parsed.nested.authorization).toBe('[REDACTED]');
    expect(parsed.nested.score).toBe(100);
  });

  it('safely handles circular references without throwing', () => {
    const circular: Record<string, unknown> = { name: 'cycle' };
    circular.self = circular;

    const serialized = safeJsonStringify(circular, []);
    const parsed = JSON.parse(serialized);

    expect(parsed.name).toBe('cycle');
    expect(parsed.self).toBe('[CIRCULAR]');
  });

  it('emits exclusively to stderr and never to stdout', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const config = createDefaultConfig();
    const logger = createShukoiLogger(config.observability, { testId: 't-1' });

    logger.info('Test log entry', { key: 'value' });

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalled();

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
