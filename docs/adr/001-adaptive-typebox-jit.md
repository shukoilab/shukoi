# ADR 001: Adaptive TypeBox Schema Validator (JIT vs AST Fallback)

## Status
Accepted

## Context
TypeBox supports two compilation and validation mechanisms:
1. `TypeCompiler.Compile(schema)`: Uses `new Function` code generation to compile schemas into ultra-fast JavaScript JIT validators (sub-millisecond evaluation).
2. `Value.Check(schema, data)`: Evaluates schemas via AST traversal without runtime code generation.

In standard Node.js and Bun environments, JIT compilation delivers maximum throughput. However, in V8 Isolate sandboxes such as Cloudflare Workers, dynamic code generation (`new Function` / `eval`) is strictly prohibited and throws an uncatchable `EvalError`.

## Decision
Implement a boot-time capability probe in `@shukoi/core/src/validator.ts`:
```typescript
export const SUPPORTS_JIT: boolean = (() => {
  try {
    const fn = new Function('return true');
    return fn() === true;
  } catch {
    return false;
  }
})();
```
If `SUPPORTS_JIT === true`, `compileSchemaValidator` compiles using `TypeCompiler.Compile`. If `false`, it falls back seamlessly to `Value.Check`.

## Consequences for AI Agents
**DO NOT REMOVE OR REFACTOR THIS PATTERN.**
- Never replace `compileSchemaValidator` with a direct call to `TypeCompiler.Compile`. Doing so will cause instant crashes on Cloudflare Workers edge deployments.
- Never strip `Value.Clone(schema)` when enforcing `additionalProperties: false`, because TypeBox schemas rely on symbol-keyed metadata (`Symbol.for('TypeBox.Kind')`) which standard `structuredClone()` destroys.
- Tested and enforced by CI Quality Gate `QG-02` (`test/qg-02-isolate-fallback.test.ts`).
