# @shukoi/core Package Constitution

## Local Scope & Boundaries

`@shukoi/core` is the platform-agnostic, zero-dependency core engine of the Shukoi framework.

### Invariants & Non-Negotiable Rules

1. **Zero `node:*` Imports:** The main package entry (`src/index.ts`) must contain ZERO imports from `node:*` or native C++ addons to remain 100% compatible with Cloudflare Workers isolates.
2. **Universal 7-Tag Docstrings:** Every public interface, method, class, and algorithm must include all 7 docstrings: `@purpose`, `@rationale`, `@preconditions`, `@param`, `@returns`, `@throws`, `@invariants`.
3. **Deep Immutability:** Context objects, compiled schemas, and action definitions must be deeply frozen using `Object.freeze` or `deepFreeze`.
4. **Adaptive Validation:** Always use `compileSchemaValidator` which probes `SUPPORTS_JIT` before compiling TypeBox schemas.
5. **Constant-Time Crypto:** Secret and token comparisons must use `safeCompareSecrets` (Web Crypto SHA-256 bitwise XOR).
