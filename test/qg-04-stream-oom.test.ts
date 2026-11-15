/**
 * @purpose Quality Gate 04 (QG-04): Chunked Stream OOM Protection Test.
 * @rationale Enforces that incoming chunked HTTP streams lacking Content-Length headers abort immediately at maxBodyBytes, preventing unbounded memory consumption and chunked-encoding OOM attacks.
 * @preconditions @shukoi/api stream reader module available.
 * @param None
 * @returns Test suite passing with exit code 0.
 * @throws Never throws unhandled; asserts test expectations.
 * @invariants Reader cancelled at threshold; memory consumption capped at maxBodyBytes.
 */

import { readBoundedJsonStream } from '@shukoi/api';
import { DomainError } from '@shukoi/core';
import { describe, expect, it } from 'vitest';

describe('QG-04: Chunked Stream OOM Protection Test', () => {
  it('aborts reader immediately when cumulative chunk bytes exceed threshold', async () => {
    let cancelInvoked = false;
    let chunksStreamed = 0;
    const chunkSize = 10 * 1024; // 10 KB per chunk
    const maxAllowedBytes = 50 * 1024; // 50 KB ceiling

    // Create stream that could emit up to 10 MB if not aborted
    const infiniteStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksStreamed++;
        const chunk = new Uint8Array(chunkSize);
        chunk.fill(120);
        controller.enqueue(chunk);
        // Emitting 1000 chunks (10MB) unless cancelled
        if (chunksStreamed >= 1000) {
          controller.close();
        }
      },
      cancel() {
        cancelInvoked = true;
      },
    });

    await expect(readBoundedJsonStream(infiniteStream, maxAllowedBytes)).rejects.toThrow(
      DomainError,
    );

    try {
      // Re-run with captured error
      const stream2 = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(chunkSize));
        },
        cancel() {
          cancelInvoked = true;
        },
      });
      await readBoundedJsonStream(stream2, maxAllowedBytes);
    } catch (err) {
      expect((err as DomainError).code).toBe('PAYLOAD_TOO_LARGE');
      expect((err as DomainError).statusCode).toBe(413);
      expect(cancelInvoked).toBe(true);
    }

    // Assert that stream did NOT stream 1000 chunks; aborted near threshold (e.g., ~6 chunks)
    expect(chunksStreamed).toBeLessThan(15);
  });
});
