/**
 * @purpose Unit tests for stream-bounded body reader and chunked OOM defense.
 * @rationale Validates that chunked streams exceeding maxBodyBytes abort immediately and release reader locks.
 * @preconditions Vitest test runner.
 * @invariants Assertions must pass with exit code 0.
 */

import { DomainError } from '@shukoi/core';
import { describe, expect, it } from 'vitest';
import { readBoundedJsonStream } from '../src/stream.js';

describe('readBoundedJsonStream', () => {
  it('reads and parses valid JSON streams within byte limits', async () => {
    const payload = JSON.stringify({ message: 'hello', count: 42 });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    });

    const parsed = await readBoundedJsonStream(stream, 1024);
    expect(parsed).toEqual({ message: 'hello', count: 42 });
  });

  it('aborts stream immediately with 413 PAYLOAD_TOO_LARGE when chunks exceed maxBytes', async () => {
    let cancelCalled = false;
    const chunk = new Uint8Array(100);
    chunk.fill(65);

    const stream = new ReadableStream({
      start(controller) {
        // Enqueue 10 chunks of 100 bytes (1000 bytes total)
        for (let i = 0; i < 10; i++) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
      cancel() {
        cancelCalled = true;
      },
    });

    // Max limit set to 250 bytes
    await expect(readBoundedJsonStream(stream, 250)).rejects.toThrow(DomainError);
    try {
      // Re-run with new stream to assert code
      const stream2 = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(300));
          controller.close();
        },
        cancel() {
          cancelCalled = true;
        },
      });
      await readBoundedJsonStream(stream2, 250);
    } catch (err) {
      expect((err as DomainError).code).toBe('PAYLOAD_TOO_LARGE');
      expect((err as DomainError).statusCode).toBe(413);
      expect(cancelCalled).toBe(true);
    }
  });

  it('throws 400 BAD_REQUEST on malformed JSON payload', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{ not-valid-json ]'));
        controller.close();
      },
    });

    await expect(readBoundedJsonStream(stream, 1024)).rejects.toThrow(DomainError);
    try {
      const stream2 = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{ invalid ]'));
          controller.close();
        },
      });
      await readBoundedJsonStream(stream2, 1024);
    } catch (err) {
      expect((err as DomainError).code).toBe('BAD_REQUEST');
      expect((err as DomainError).statusCode).toBe(400);
    }
  });

  it('returns empty object when stream is null or empty', async () => {
    expect(await readBoundedJsonStream(null, 1024)).toEqual({});

    const emptyStream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    expect(await readBoundedJsonStream(emptyStream, 1024)).toEqual({});
  });
});
