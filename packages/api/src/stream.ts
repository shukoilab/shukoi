/**
 * @purpose Stream-bounded HTTP body reader protecting against chunked transfer-encoding OOM attacks.
 * @rationale Attackers can bypass Content-Length header checks by streaming infinite chunked bodies. Reading raw chunks with a cumulative byte counter guarantees immediate abort at maxBodyBytes.
 * @preconditions stream is a ReadableStream<Uint8Array> or null; maxBytes is a positive integer.
 * @invariants Reads at chunk granularity; cancels reader immediately on threshold breach; zero memory leaks.
 */

import { DomainError } from '@shukoi/core';

/**
 * @purpose Reads a ReadableStream up to a strict byte limit and parses the resulting UTF-8 buffer as JSON.
 * @rationale Prevents unbounded buffer allocation by aborting the stream reader the moment receivedBytes exceeds maxBytes.
 * @param stream Incoming HTTP request body stream.
 * @param maxBytes Maximum cumulative byte threshold.
 * @returns Promise resolving to parsed JSON value, or empty object if stream is null/empty.
 * @throws DomainError('PAYLOAD_TOO_LARGE', ..., 413) if cumulative bytes exceed maxBytes.
 * @throws DomainError('BAD_REQUEST', ..., 400) if JSON parsing fails on valid-sized payload.
 * @invariants Big-O time complexity O(b) where b is payload bytes; space complexity capped at maxBytes.
 */
export async function readBoundedJsonStream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<unknown> {
  if (!stream) {
    return {};
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          // Immediately cancel the reader to halt upstream transmission
          await reader.cancel('PAYLOAD_TOO_LARGE').catch(() => {});
          throw new DomainError(
            'PAYLOAD_TOO_LARGE',
            `Request body exceeded maximum allowable size of ${maxBytes} bytes`,
            413,
          );
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (chunks.length === 0 || totalBytes === 0) {
    return {};
  }

  // Concatenate chunks into contiguous Uint8Array
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const text = new TextDecoder('utf-8').decode(combined);
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {};
  }

  try {
    return JSON.parse(trimmed);
  } catch (parseErr) {
    throw new DomainError(
      'BAD_REQUEST',
      `Malformed JSON payload: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      400,
    );
  }
}
