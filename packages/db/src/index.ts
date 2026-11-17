/**
 * @purpose Universal database transaction orchestration and modular ORM adapters for Shukoi.
 * @rationale Enables turnkey database integration with composite cancellation, outbox guarantees, and zero connection leaks.
 * @preconditions Configured database driver or ORM instance.
 * @invariants Pure Web-standard core; thread-safe across concurrent transactions; zero memory leaks.
 */

export * from './d1.js';
export * from './drizzle.js';
export * from './kysely.js';
export * from './manager.js';
export * from './outbox.js';
export * from './prisma.js';
export * from './testing.js';
export * from './types.js';
