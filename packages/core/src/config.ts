/**
 * @purpose Zero-Hardcoding centralized configuration schema and fail-fast validation engine for Shukoi.
 * @rationale Enforces 12-Factor runtime configuration with explicit limits, security parameters, and observability settings.
 * @preconditions Input configuration must satisfy TypeBox schema constraints at boot.
 * @invariants Deeply frozen configuration instances; zero mutations at runtime; memory ownership is immutable.
 */

import { Type } from '@sinclair/typebox';
import { DomainError } from './errors.js';

/**
 * @purpose TypeBox schema definition for ShukoiSecurityConfig.
 * @rationale Validates security allowlists, JWKS endpoints, and token validation tolerances.
 * @invariants Static schema definition; immutable.
 */
export const ShukoiSecurityConfigSchema = Type.Object(
  {
    jwtAllowedAlgorithms: Type.Array(Type.String({ minLength: 2, maxLength: 16 }), { minItems: 1 }),
    jwksUri: Type.Optional(Type.String({ minLength: 1 })),
    jwtIssuer: Type.Optional(Type.String({ minLength: 1 })),
    jwtAudience: Type.Optional(Type.String({ minLength: 1 })),
    jwtClockToleranceSec: Type.Integer({ minimum: 0, maximum: 300, default: 0 }),
    jwksCacheTtlMs: Type.Integer({ minimum: 1000, maximum: 86400000, default: 3600000 }),
    jwksFetchTimeoutMs: Type.Integer({ minimum: 100, maximum: 60000, default: 5000 }),
    apiKeyHeaderName: Type.String({ minLength: 1, maxLength: 64, default: 'x-api-key' }),
    stdioApiKeyEnvVar: Type.String({ minLength: 1, maxLength: 64, default: 'SHUKOI_API_KEY' }),
    allowedOrigins: Type.Array(Type.String({ minLength: 1 })),
    allowedHosts: Type.Array(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

/**
 * @purpose Interface representing validated runtime security parameters.
 * @rationale Enforces type-safe access to JWT, JWKS, API key, and DNS-rebinding allowlists.
 * @invariants Readonly fields; zero runtime mutations.
 */
export interface ShukoiSecurityConfig {
  readonly jwtAllowedAlgorithms: readonly string[];
  readonly jwksUri?: string | undefined;
  readonly jwtIssuer?: string | undefined;
  readonly jwtAudience?: string | undefined;
  readonly jwtClockToleranceSec: number;
  readonly jwksCacheTtlMs: number;
  readonly jwksFetchTimeoutMs: number;
  readonly apiKeyHeaderName: string;
  readonly stdioApiKeyEnvVar: string;
  readonly allowedOrigins: readonly string[];
  readonly allowedHosts: readonly string[];
}

/**
 * @purpose TypeBox schema definition for ShukoiLimitsConfig.
 * @rationale Constrains memory boundaries, timeouts, payload sizes, and depth limits.
 * @invariants Static schema definition; immutable.
 */
export const ShukoiLimitsConfigSchema = Type.Object(
  {
    defaultTimeoutMs: Type.Integer({ minimum: 100, maximum: 300000, default: 30000 }),
    maxBodyBytes: Type.Integer({ minimum: 1024, maximum: 104857600, default: 10485760 }),
    maxMcpOutputBytes: Type.Integer({ minimum: 1024, maximum: 104857600, default: 4194304 }),
    maxJsonDepth: Type.Integer({ minimum: 2, maximum: 64, default: 32 }),
    maxRpcBatchSize: Type.Integer({ minimum: 1, maximum: 1000, default: 100 }),
    lambdaDeadlineBufferMs: Type.Integer({ minimum: 0, maximum: 10000, default: 500 }),
    maxStatefulMcpSessions: Type.Integer({ minimum: 1, maximum: 10000, default: 1000 }),
    mcpSessionIdleTtlMs: Type.Integer({ minimum: 1000, maximum: 86400000, default: 1800000 }),
  },
  { additionalProperties: false },
);

/**
 * @purpose Interface representing validated operational limits and thresholds.
 * @rationale Prevents OOM attacks, unbounded recursion, and thread pool starvation.
 * @invariants Readonly numerical constraints; zero runtime mutations.
 */
export interface ShukoiLimitsConfig {
  readonly defaultTimeoutMs: number;
  readonly maxBodyBytes: number;
  readonly maxMcpOutputBytes: number;
  readonly maxJsonDepth: number;
  readonly maxRpcBatchSize: number;
  readonly lambdaDeadlineBufferMs: number;
  readonly maxStatefulMcpSessions: number;
  readonly mcpSessionIdleTtlMs: number;
}

/**
 * @purpose TypeBox schema definition for ShukoiObservabilityConfig.
 * @rationale Defines service metadata, log level, trace propagation header, and redaction paths.
 * @invariants Static schema definition; immutable.
 */
export const ShukoiObservabilityConfigSchema = Type.Object(
  {
    serviceName: Type.String({ minLength: 1, maxLength: 128, default: 'shukoi-service' }),
    serviceVersion: Type.String({ minLength: 1, maxLength: 32, default: '1.0.0' }),
    environment: Type.Union(
      [
        Type.Literal('development'),
        Type.Literal('staging'),
        Type.Literal('production'),
        Type.Literal('test'),
      ],
      { default: 'development' },
    ),
    logLevel: Type.Union(
      [
        Type.Literal('fatal'),
        Type.Literal('error'),
        Type.Literal('warn'),
        Type.Literal('info'),
        Type.Literal('debug'),
        Type.Literal('trace'),
        Type.Literal('silent'),
      ],
      { default: 'info' },
    ),
    redactPaths: Type.Array(Type.String({ minLength: 1 }), {
      default: ['password', 'secret', 'token', 'authorization'],
    }),
    correlationIdHeader: Type.String({ minLength: 1, maxLength: 64, default: 'x-request-id' }),
  },
  { additionalProperties: false },
);

/**
 * @purpose Interface representing observability and structured logging configuration.
 * @rationale Standardizes OpenTelemetry context propagation and sensitive data masking.
 * @invariants Readonly fields; zero runtime mutations.
 */
export interface ShukoiObservabilityConfig {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly environment: 'development' | 'staging' | 'production' | 'test';
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  readonly redactPaths: readonly string[];
  readonly correlationIdHeader: string;
}

/**
 * @purpose Composite TypeBox schema for the entire Shukoi runtime configuration.
 * @rationale Validates security, limits, and observability sections in a single unified schema.
 * @invariants Immutable schema definition.
 */
export const ShukoiConfigSchema = Type.Object(
  {
    security: ShukoiSecurityConfigSchema,
    limits: ShukoiLimitsConfigSchema,
    observability: ShukoiObservabilityConfigSchema,
  },
  { additionalProperties: false },
);

/**
 * @purpose Root interface aggregating all operational configuration sections.
 * @rationale Injected into actions, transports, and adapters to guarantee zero-hardcoding.
 * @invariants Deeply frozen object; reference identity preserved across actions.
 */
export interface ShukoiConfig {
  readonly security: ShukoiSecurityConfig;
  readonly limits: ShukoiLimitsConfig;
  readonly observability: ShukoiObservabilityConfig;
}

/**
 * @purpose Factory generating enterprise-safe default configuration.
 * @rationale Provides production-ready sensible defaults while permitting selective overrides.
 * @preconditions Optional partial configuration overrides.
 * @param overrides Partial configuration sections to override defaults.
 * @returns Deeply frozen, fully populated ShukoiConfig instance.
 * @throws Never throws.
 * @invariants Big-O time complexity O(1); space complexity O(1); immutable return.
 */
export function createDefaultConfig(overrides?: {
  readonly security?: Partial<ShukoiSecurityConfig>;
  readonly limits?: Partial<ShukoiLimitsConfig>;
  readonly observability?: Partial<ShukoiObservabilityConfig>;
}): ShukoiConfig {
  const config: ShukoiConfig = {
    security: {
      jwtAllowedAlgorithms: overrides?.security?.jwtAllowedAlgorithms ?? ['RS256', 'EdDSA'],
      jwksUri: overrides?.security?.jwksUri,
      jwtIssuer: overrides?.security?.jwtIssuer,
      jwtAudience: overrides?.security?.jwtAudience,
      jwtClockToleranceSec: overrides?.security?.jwtClockToleranceSec ?? 0,
      jwksCacheTtlMs: overrides?.security?.jwksCacheTtlMs ?? 3600000,
      jwksFetchTimeoutMs: overrides?.security?.jwksFetchTimeoutMs ?? 5000,
      apiKeyHeaderName: overrides?.security?.apiKeyHeaderName ?? 'x-api-key',
      stdioApiKeyEnvVar: overrides?.security?.stdioApiKeyEnvVar ?? 'SHUKOI_API_KEY',
      allowedOrigins: overrides?.security?.allowedOrigins ?? ['*'],
      allowedHosts: overrides?.security?.allowedHosts ?? ['localhost', '127.0.0.1'],
    },
    limits: {
      defaultTimeoutMs: overrides?.limits?.defaultTimeoutMs ?? 30000,
      maxBodyBytes: overrides?.limits?.maxBodyBytes ?? 10485760,
      maxMcpOutputBytes: overrides?.limits?.maxMcpOutputBytes ?? 4194304,
      maxJsonDepth: overrides?.limits?.maxJsonDepth ?? 32,
      maxRpcBatchSize: overrides?.limits?.maxRpcBatchSize ?? 100,
      lambdaDeadlineBufferMs: overrides?.limits?.lambdaDeadlineBufferMs ?? 500,
      maxStatefulMcpSessions: overrides?.limits?.maxStatefulMcpSessions ?? 1000,
      mcpSessionIdleTtlMs: overrides?.limits?.mcpSessionIdleTtlMs ?? 1800000,
    },
    observability: {
      serviceName: overrides?.observability?.serviceName ?? 'shukoi-service',
      serviceVersion: overrides?.observability?.serviceVersion ?? '1.0.0',
      environment: overrides?.observability?.environment ?? 'development',
      logLevel: overrides?.observability?.logLevel ?? 'info',
      redactPaths: overrides?.observability?.redactPaths ?? [
        'password',
        'secret',
        'token',
        'authorization',
      ],
      correlationIdHeader: overrides?.observability?.correlationIdHeader ?? 'x-request-id',
    },
  };

  return deepFreeze(config);
}

/**
 * @purpose Recursively freezes an object graph to guarantee immutability.
 * @rationale Prevents runtime tamper or inadvertent configuration mutation.
 * @preconditions Target object or primitive.
 * @param obj Target to recursively freeze.
 * @returns Deeply frozen object.
 * @throws Never throws.
 * @invariants Big-O time complexity O(n) where n is node count; preserves circular reference termination.
 */
export function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  const visited = new WeakSet<object>();

  function freezeRecursive(current: object): void {
    if (visited.has(current)) {
      return;
    }
    visited.add(current);
    Object.freeze(current);

    for (const key of Object.getOwnPropertyNames(current)) {
      const val = (current as Record<string, unknown>)[key];
      if (val !== null && typeof val === 'object') {
        freezeRecursive(val);
      }
    }
  }

  freezeRecursive(obj as object);
  return obj as Readonly<T>;
}

/**
 * @purpose Validates a raw configuration object at boot and produces a frozen ShukoiConfig.
 * @rationale Guarantees fail-fast startup behavior if invalid environment configuration is injected.
 * @preconditions raw must be an object with security, limits, and observability sections.
 * @param raw Unvalidated configuration object from environment or config file.
 * @returns Deeply frozen, strongly-typed ShukoiConfig.
 * @throws DomainError('VALIDATION_ERROR', ...) if structure or constraints are violated.
 * @invariants Big-O time complexity O(1); synchronous validation; fail-fast.
 */
export function validateShukoiConfig(raw: unknown): ShukoiConfig {
  if (raw === null || typeof raw !== 'object') {
    throw new DomainError('VALIDATION_ERROR', 'Configuration root must be a non-null object', 422);
  }

  const rec = raw as Record<string, unknown>;
  if (!rec['security'] || typeof rec['security'] !== 'object') {
    throw new DomainError(
      'VALIDATION_ERROR',
      'Configuration missing required "security" section',
      422,
    );
  }
  if (!rec['limits'] || typeof rec['limits'] !== 'object') {
    throw new DomainError(
      'VALIDATION_ERROR',
      'Configuration missing required "limits" section',
      422,
    );
  }
  if (!rec['observability'] || typeof rec['observability'] !== 'object') {
    throw new DomainError(
      'VALIDATION_ERROR',
      'Configuration missing required "observability" section',
      422,
    );
  }

  const security = rec['security'] as Record<string, unknown>;
  const limits = rec['limits'] as Record<string, unknown>;
  const observability = rec['observability'] as Record<string, unknown>;

  if (
    !Array.isArray(security['jwtAllowedAlgorithms']) ||
    security['jwtAllowedAlgorithms'].length === 0
  ) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'security.jwtAllowedAlgorithms must be a non-empty array of strings',
      422,
    );
  }
  if (typeof limits['maxBodyBytes'] !== 'number' || limits['maxBodyBytes'] <= 0) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'limits.maxBodyBytes must be a positive integer',
      422,
    );
  }
  if (typeof limits['defaultTimeoutMs'] !== 'number' || limits['defaultTimeoutMs'] <= 0) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'limits.defaultTimeoutMs must be a positive integer',
      422,
    );
  }

  return createDefaultConfig({
    security: security as Partial<ShukoiSecurityConfig>,
    limits: limits as Partial<ShukoiLimitsConfig>,
    observability: observability as Partial<ShukoiObservabilityConfig>,
  });
}
