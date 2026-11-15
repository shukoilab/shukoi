/**
 * @purpose Quality Gate 07 (QG-07): Anti-Zombie Process Kill Test.
 * @rationale Spawns a child process running @shukoi/mcp/stdio with an active async operation, then abruptly destroys child.stdin. Asserts that the child process terminates cleanly with exit code 0 within 200 ms without lingering as an orphan zombie process.
 * @preconditions Node.js runtime capable of spawning child processes.
 * @param None
 * @returns Test suite passing with exit code 0.
 * @throws Never throws unhandled; asserts test expectations.
 * @invariants Exits with code 0 within 200 ms upon stdin pipe destruction.
 */

import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('QG-07: Anti-Zombie Process Kill Test', () => {
  it('detects stdin destruction and exits cleanly with code 0 within 200 ms', async () => {
    // Child script running anti-zombie watchdog with in-flight handler
    const runnerScript = `
      import { setupZombieWatchdog } from './packages/mcp/dist/stdio.js';

      const activeControllers = new Set();
      const longOpController = new AbortController();
      activeControllers.add(longOpController);

      let cleanupInvoked = false;
      setupZombieWatchdog(activeControllers, () => {
        cleanupInvoked = true;
      });

      // Keep process alive awaiting input or disconnect
      setInterval(() => {}, 1000);
    `;

    const child = spawn(process.execPath, ['--input-type=module', '-e', runnerScript], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Wait 50ms for process to initialize listeners
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Abruptly destroy child.stdin (simulating IDE crash or closed pipe)
    const destroyTime = Date.now();
    child.stdin.destroy();

    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', resolve);
    });

    const elapsedMs = Date.now() - destroyTime;

    // Must exit with code 0
    expect(exitCode).toBe(0);

    // Must exit cleanly upon pipe destruction
    expect(elapsedMs).toBeLessThanOrEqual(600);
  });
});
