/**
 * @purpose Root exports for @shukoi/core micro-framework engine.
 * @rationale Exposes the universal action contract, adaptive schema validator, zero-dependency logger, auth, and execution pipeline.
 * @preconditions Peer dependency @sinclair/typebox installed.
 * @invariants Zero node:* imports in root package entry; 100% web-standard compatible.
 */

export * from './action.js';
export * from './auth.js';
export * from './config.js';
export * from './errors.js';
export * from './executeAction.js';
export * from './idempotency.js';
export * from './logger.js';
export * from './validator.js';
