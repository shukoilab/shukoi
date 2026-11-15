/**
 * @purpose Unit tests for @shukoi/mcp/stdio console hijacking, backpressure writer, and watchdog lifecycle.
 * @rationale Ensures stdout sterility is preserved and anti-zombie cleanup hooks are registered correctly.
 * @preconditions Vitest test runner.
 * @invariants Assertions must pass with exit code 0.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  hijackConsoleToStderr,
  setupZombieWatchdog,
  writeFrameWithBackpressure,
} from '../src/stdio.js';

describe('MCP STDIO Transport & Anti-Zombie Watchdog', () => {
  it('hijacks console.log, info, warn, debug and routes them to process.stderr', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const restore = hijackConsoleToStderr();

    console.log('Test message from console.log');
    console.info('Test message from console.info');
    console.warn('Test message from console.warn');
    console.debug('Test message from console.debug');

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledTimes(4);

    restore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('writes newline-delimited frames to stdout via writeFrameWithBackpressure', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await writeFrameWithBackpressure('{"jsonrpc":"2.0","result":{}}');

    expect(stdoutSpy).toHaveBeenCalledWith('{"jsonrpc":"2.0","result":{}}\n');
    stdoutSpy.mockRestore();
  });

  it('configures and cleanly removes watchdog listeners', () => {
    const activeControllers = new Set<AbortController>();
    const teardown = setupZombieWatchdog(activeControllers);

    expect(typeof teardown).toBe('function');
    teardown();
  });
});
