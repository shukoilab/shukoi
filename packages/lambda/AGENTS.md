# @shukoi/lambda Package Constitution

## Local Scope & Boundaries

`@shukoi/lambda` adapts Shukoi Hono applications to AWS Lambda (API Gateway v1/v2, ALB, and Function URL) running on Node.js 22+ ESM.

### Invariants & Non-Negotiable Rules

1. **Dynamic Deadline Calculation:** Computes `effectiveTimeoutMs = Math.min(actionTimeout, lambdaContext.getRemainingTimeInMillis() - config.limits.lambdaDeadlineBufferMs)`.
2. **Early 504 Gateway Timeout:** If `effectiveTimeoutMs <= 0`, aborts immediately with 504 without starting database transactions.
3. **Container Freeze Safety:** Aborts `ctx.signal` at `effectiveTimeoutMs` to ensure database transactions roll back cleanly before Lambda container freeze.
