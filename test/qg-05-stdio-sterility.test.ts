/**
 * @purpose Quality Gate 05 (QG-05): STDIO stdout Sterility & Drain Test.
 * @rationale Spawns a child process running @shukoi/mcp/stdio emitting console logs, warnings, and a large 512 KB JSON-RPC response payload. Asserts that 100% of lines on child.stdout parse as valid JSON-RPC frames with zero console text pollution.
 * @preconditions Node.js runtime capable of spawning child processes.
 * @param None
 * @returns Test suite passing with exit code 0.
 * @throws Never throws unhandled; asserts test expectations.
 * @invariants 100% stdout sterility; stderr-only logging.
 */

import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('QG-05: STDIO stdout Sterility & Drain Test', () => {
  it('guarantees 100% stdout sterility and backpressure handling with a 512 KB payload', async () => {
    // Child script that hijacks console, prints noisy logs to console, and sends a 512KB payload via writeFrameWithBackpressure
    const runnerScript = `
      import { hijackConsoleToStderr, writeFrameWithBackpressure } from './packages/mcp/dist/stdio.js';

      hijackConsoleToStderr();

      // Noisy application logs that would corrupt stdout if not redirected
      console.log('NOISY LOG 1: Startup initiated');
      console.warn('NOISY WARN 2: Deprecation notice');
      console.error('NOISY ERR 3: Simulated operational log');
      console.debug('NOISY DEBUG 4: Tracing payload');

      // Generate 512 KB JSON payload
      const largeData = 'X'.repeat(512 * 1024);
      const jsonRpcFrame = JSON.stringify({
        jsonrpc: '2.0',
        id: 'large-msg-512kb',
        result: {
          payloadSize: largeData.length,
          data: largeData,
        },
      });

      await writeFrameWithBackpressure(jsonRpcFrame);

      console.log('NOISY LOG 5: Transmission complete');
      process.exit(0);
    `;

    const child = spawn(process.execPath, ['--input-type=module', '-e', runnerScript], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdoutData = '';
    let stderrData = '';

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString('utf-8');
    });

    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString('utf-8');
    });

    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', resolve);
    });

    expect(exitCode).toBe(0);

    // 1. Assert stdout is NOT empty
    expect(stdoutData.length).toBeGreaterThanOrEqual(512 * 1024);

    // 2. Assert every single line on stdout parses cleanly as valid JSON-RPC
    const lines = stdoutData.trim().split('\n');
    expect(lines.length).toBe(1);

    const firstLine = lines[0] ?? '';
    const parsedFrame = JSON.parse(firstLine) as {
      jsonrpc: string;
      id: string;
      result: { payloadSize: number; data: string };
    };

    expect(parsedFrame.jsonrpc).toBe('2.0');
    expect(parsedFrame.id).toBe('large-msg-512kb');
    expect(parsedFrame.result.payloadSize).toBe(512 * 1024);

    // 3. Assert all noisy console logs were routed exclusively to stderr
    expect(stderrData).toContain('NOISY LOG 1');
    expect(stderrData).toContain('NOISY WARN 2');
    expect(stderrData).toContain('NOISY ERR 3');
    expect(stderrData).toContain('NOISY DEBUG 4');
    expect(stderrData).toContain('NOISY LOG 5');

    // 4. Zero console log text appeared on stdout
    expect(stdoutData).not.toContain('NOISY');
  });
});
