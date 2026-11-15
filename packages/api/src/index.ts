/**
 * @purpose Root exports for @shukoi/api package (Protocol Module A).
 * @rationale Exposes REST router, OpenAPI 3.1 generator, and stream-bounded body reader.
 * @preconditions Peer dependencies @shukoi/core and hono installed.
 * @invariants Pure Web-Standard exports; zero node:* dependencies.
 */

export * from './openapi.js';
export * from './router.js';
export * from './stream.js';
