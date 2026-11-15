/**
 * @purpose Unit tests verifying DomainError serialization to RFC 9457 Problem Details.
 * @rationale Ensures uniform error responses across REST and MCP transports without leaking internal details.
 * @preconditions Vitest test runner.
 * @invariants Assertions must pass with exit code 0.
 */

import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/errors.js';

describe('DomainError', () => {
  it('instantiates domain errors with correct default status codes', () => {
    const notFound = new DomainError('NOT_FOUND', 'Entity not found');
    expect(notFound.code).toBe('NOT_FOUND');
    expect(notFound.statusCode).toBe(404);
    expect(notFound.detail).toBe('Entity not found');

    const unauthorized = new DomainError('UNAUTHORIZED', 'Invalid credentials');
    expect(unauthorized.statusCode).toBe(401);
  });

  it('serializes to RFC 9457 Problem Details object', () => {
    const error = new DomainError('VALIDATION_ERROR', 'Validation failed on fields', 422, [
      { path: '/age', message: 'Expected integer >= 0' },
    ]);

    const problem = error.toProblemDetails('req-123', '/api/users');
    expect(problem.type).toBe('urn:shukoi:error:validation-error');
    expect(problem.title).toBe('VALIDATION ERROR');
    expect(problem.status).toBe(422);
    expect(problem.detail).toBe('Validation failed on fields');
    expect(problem.requestId).toBe('req-123');
    expect(problem.instance).toBe('/api/users');
    expect(problem.errors).toEqual([{ path: '/age', message: 'Expected integer >= 0' }]);
    expect(Object.isFrozen(problem)).toBe(true);
  });
});
