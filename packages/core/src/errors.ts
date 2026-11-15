/**
 * @purpose RFC 9457 Problem Details error definitions and typed domain error hierarchy.
 * @rationale Ensures uniform error responses across REST, MCP, and internal pipelines with zero internal stack leakage to untrusted clients.
 * @preconditions Error codes must map to deterministic HTTP status codes and machine-readable tokens.
 * @invariants Pure in-memory error objects; immutable error structures; zero side effects.
 */

/**
 * @purpose Standardized domain error code enum representing system failure modes.
 * @rationale Provides stable, machine-readable error discriminators for clients and automated retry systems.
 * @preconditions Valid domain error category defined by framework architecture.
 * @invariants Const string union enum; time complexity O(1).
 */
export type DomainErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_SERVER_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'GATEWAY_TIMEOUT';

/**
 * @purpose Mapping of domain error codes to default HTTP status codes.
 * @rationale Guarantees predictable HTTP status codes without ad-hoc magic numbers across handlers.
 * @preconditions DomainErrorCode key.
 * @invariants Readonly static dictionary; time complexity O(1).
 */
export const DEFAULT_STATUS_MAP: Readonly<Record<DomainErrorCode, number>> = Object.freeze({
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  VALIDATION_ERROR: 422,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
});

/**
 * @purpose RFC 9457 Problem Details payload interface.
 * @rationale Standardizes HTTP error serialization across REST and MCP transports.
 * @preconditions Required fields title, status, code, detail, and requestId.
 * @invariants Deeply frozen upon serialization; zero mutation.
 */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance?: string | undefined;
  readonly requestId: string;
  readonly code: DomainErrorCode;
  readonly errors?: readonly { readonly path: string; readonly message: string }[] | undefined;
}

/**
 * @purpose Strongly-typed domain error exception class for all recoverable and unrecoverable framework failures.
 * @rationale Enforces deterministic error codes, HTTP statuses, and client-safe details across all framework layers.
 * @preconditions code must be a valid DomainErrorCode; statusCode must be an integer between 400 and 599.
 * @param code Machine-readable domain error code.
 * @param detail Human-readable explanation suitable for client consumption.
 * @param statusCode Explicit HTTP status code overriding default map.
 * @param errors Optional array of granular field validation errors.
 * @returns Instantiated DomainError instance with captured stack trace.
 * @throws Never throws internally during construction.
 * @invariants Inherits from standard Error; immutable properties; zero prototype corruption.
 */
export class DomainError extends Error {
  public readonly code: DomainErrorCode;
  public readonly statusCode: number;
  public readonly detail: string;
  public readonly errors?:
    | readonly { readonly path: string; readonly message: string }[]
    | undefined;

  public constructor(
    code: DomainErrorCode,
    detail: string,
    statusCode?: number,
    errors?: readonly { readonly path: string; readonly message: string }[],
  ) {
    super(detail);
    this.name = 'DomainError';
    this.code = code;
    this.detail = detail;
    this.statusCode = statusCode ?? DEFAULT_STATUS_MAP[code] ?? 500;
    this.errors = errors ? Object.freeze([...errors]) : undefined;
    Object.freeze(this);
  }

  /**
   * @purpose Serializes the domain error into an RFC 9457 compliant Problem Details object.
   * @rationale Prevents internal stack trace leakage while conveying actionable structured error details.
   * @preconditions Valid instance with non-empty code and status.
   * @param requestId Correlation identifier for request tracing.
   * @param instance Optional URI reference identifying the specific error occurrence.
   * @returns Readonly RFC 9457 Problem Details object.
   * @throws Never throws.
   * @invariants Pure serialization method; Big-O time complexity O(1).
   */
  public toProblemDetails(requestId = 'req-unknown', instance?: string): ProblemDetails {
    const payload: ProblemDetails = {
      type: `urn:shukoi:error:${this.code.toLowerCase().replace(/_/g, '-')}`,
      title: this.code.replace(/_/g, ' '),
      status: this.statusCode,
      detail: this.detail,
      requestId,
      code: this.code,
      ...(instance !== undefined ? { instance } : {}),
      ...(this.errors !== undefined ? { errors: this.errors } : {}),
    };
    return Object.freeze(payload);
  }
}
