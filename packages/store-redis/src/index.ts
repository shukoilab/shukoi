/**
 * @purpose Root exports for @shukoi/store-redis package.
 * @rationale Exposes distributed Redis idempotency store, atomic Lua scripts, and client adapters.
 * @preconditions Peer dependency @shukoi/core must be installed.
 * @invariants Pure exports; thread-safe; zero node:* imports in edge mode.
 */

export * from './adapter.js';
export * from './lua.js';
export * from './store.js';
export * from './types.js';
export * from './upstash.js';
