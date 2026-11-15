/**
 * @purpose Web-standard zero-dependency structured JSON logger with guaranteed stdout sterility.
 * @rationale MCP STDIO protocol requires process.stdout to be 100% sterile for JSON-RPC frames. All logging must route strictly to process.stderr or console.error.
 * @preconditions Observability configuration must define service metadata, log level, and redaction paths.
 * @invariants Zero external dependencies; WeakSet circular reference prevention; stderr-exclusive emission.
 */

import type { ShukoiObservabilityConfig } from './config.js';

/**
 * @purpose Numeric severity values for log level filtering.
 * @rationale Enables fast O(1) integer comparison to determine if a log entry should be emitted.
 * @invariants Readonly map; monotonic ordering.
 */
export const LOG_LEVEL_SEVERITY: Readonly<Record<ShukoiObservabilityConfig['logLevel'], number>> =
  Object.freeze({
    silent: 0,
    fatal: 10,
    error: 20,
    warn: 30,
    info: 40,
    debug: 50,
    trace: 60,
  });

/**
 * @purpose Interface representing the Shukoi structured logger.
 * @rationale Provides uniform logging methods and contextual child logger creation.
 * @invariants Pure interface; thread-safe across concurrent async operations.
 */
export interface ShukoiLogger {
  child(bindings: Record<string, unknown>): ShukoiLogger;
  fatal(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
  trace(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * @purpose Safe JSON serialization helper with circular reference guard and path redaction.
 * @rationale Prevents TypeError: Converting circular structure to JSON and masks sensitive secrets.
 * @preconditions target is an arbitrary JS object graph; redactKeys is an array of lowercase strings.
 * @param target Data object to serialize.
 * @param redactKeys List of field names that must be replaced with '[REDACTED]'.
 * @returns Safe JSON string.
 * @throws Never throws; serialization errors are captured and returned as fallback strings.
 * @invariants WeakSet prevents infinite loops on circular graphs; Big-O time complexity O(n).
 */
export function safeJsonStringify(target: unknown, redactKeys: readonly string[]): string {
  const seen = new WeakSet<object>();
  const redactSet = new Set(redactKeys.map((k) => k.toLowerCase()));

  try {
    return JSON.stringify(target, (_key: string, value: unknown) => {
      if (typeof _key === 'string' && redactSet.has(_key.toLowerCase())) {
        return '[REDACTED]';
      }

      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[CIRCULAR]';
        }
        seen.add(value);
      }

      if (typeof value === 'bigint') {
        return value.toString();
      }

      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      }

      return value;
    });
  } catch (err) {
    return `{"level":"error","msg":"Failed to serialize log entry: ${err instanceof Error ? err.message : String(err)}"}`;
  }
}

/**
 * @purpose Writes a log line exclusively to process.stderr or console.error.
 * @rationale Protects File Descriptor 1 (process.stdout) for MCP STDIO protocol frames.
 * @preconditions line is a single-line JSON string without trailing newline.
 * @param line Formatted JSON string to emit.
 * @returns void
 * @throws Never throws.
 * @invariants Guaranteed zero writes to process.stdout.
 */
function emitStderr(line: string): void {
  // In Node.js / Bun runtime: write directly to process.stderr
  if (
    typeof process !== 'undefined' &&
    process.stderr &&
    typeof process.stderr.write === 'function'
  ) {
    process.stderr.write(`${line}\n`);
    return;
  }
  // In Cloudflare Workers / pure V8 sandboxes: console.error routes to runtime logs
  // biome-ignore lint/suspicious/noConsole: Isolate edge logging fallback
  console.error(line);
}

/**
 * @purpose Factory creating a Shukoi structured logger instance.
 * @rationale Provides root logger and scoped child loggers with contextual bindings (e.g., requestId).
 * @preconditions config must provide observability parameters.
 * @param config ShukoiObservabilityConfig instance.
 * @param bindings Key-value pairs bound to every log entry produced by this logger.
 * @returns ShukoiLogger instance.
 * @throws Never throws.
 * @invariants Immutable bindings map; O(1) log-level filtering; zero stdout emission.
 */
export function createShukoiLogger(
  config: ShukoiObservabilityConfig,
  bindings: Record<string, unknown> = {},
): ShukoiLogger {
  const configuredThreshold = LOG_LEVEL_SEVERITY[config.logLevel] ?? LOG_LEVEL_SEVERITY.info;
  const frozenBindings = Object.freeze({ ...bindings });

  function log(
    level: ShukoiObservabilityConfig['logLevel'],
    msg: string,
    meta?: Record<string, unknown>,
  ): void {
    const levelSeverity = LOG_LEVEL_SEVERITY[level] ?? 40;
    if (configuredThreshold === 0 || levelSeverity > configuredThreshold) {
      return;
    }

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: config.serviceName,
      version: config.serviceVersion,
      env: config.environment,
      msg,
      ...frozenBindings,
      ...(meta !== undefined ? meta : {}),
    };

    const serialized = safeJsonStringify(entry, config.redactPaths);
    emitStderr(serialized);
  }

  const loggerInstance: ShukoiLogger = {
    child(newBindings: Record<string, unknown>): ShukoiLogger {
      return createShukoiLogger(config, { ...frozenBindings, ...newBindings });
    },
    fatal(msg: string, meta?: Record<string, unknown>): void {
      log('fatal', msg, meta);
    },
    error(msg: string, meta?: Record<string, unknown>): void {
      log('error', msg, meta);
    },
    warn(msg: string, meta?: Record<string, unknown>): void {
      log('warn', msg, meta);
    },
    info(msg: string, meta?: Record<string, unknown>): void {
      log('info', msg, meta);
    },
    debug(msg: string, meta?: Record<string, unknown>): void {
      log('debug', msg, meta);
    },
    trace(msg: string, meta?: Record<string, unknown>): void {
      log('trace', msg, meta);
    },
  };

  return Object.freeze(loggerInstance);
}
