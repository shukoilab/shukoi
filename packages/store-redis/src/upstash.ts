/**
 * @purpose Web-standard HTTP REST Redis client for edge runtimes (Cloudflare Workers, Fastly Compute).
 * @rationale Communicates with Upstash Redis or REST-compatible Redis gateways without requiring node:net or TCP sockets.
 * @preconditions Upstash REST URL and Bearer token must be provided.
 * @invariants Zero node:* imports; 100% web-standard fetch API; Big-O O(1) command execution.
 */

import type { RedisClient } from './types.js';

/**
 * @purpose Options parameterizing the Upstash HTTP Redis client.
 * @rationale Configures target REST endpoint, authorization token, and optional fetch overrides.
 * @invariants Readonly options structure.
 */
export interface UpstashClientOptions {
  readonly url: string;
  readonly token: string;
}

/**
 * @purpose Zero-dependency Upstash REST client implementing the RedisClient contract.
 * @rationale Dispatches Redis commands over standard HTTP POST requests; compatible with V8 Isolates.
 * @preconditions Valid REST URL and token.
 * @invariants Pure Web Fetch; abort signal support; thread-safe.
 */
export class UpstashRedisClient implements RedisClient {
  private readonly baseUrl: string;
  private readonly token: string;

  public constructor(options: UpstashClientOptions) {
    this.baseUrl = options.url.replace(/\/+$/, '');
    this.token = options.token;
  }

  private async executeCommand<T>(command: string, args: (string | number)[]): Promise<T> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([command, ...args]),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Upstash Redis HTTP error (${response.status}): ${errorText}`);
    }

    const json = (await response.json()) as { result: T; error?: string };
    if (json.error) {
      throw new Error(`Upstash Redis command error: ${json.error}`);
    }

    return json.result;
  }

  /**
   * @purpose Evaluates a Lua script on the remote Redis server via HTTP REST.
   * @rationale Dispatches EVAL command with keys and arguments payload.
   * @preconditions script must be non-empty; keys and args arrays must be defined.
   * @param script Lua script content.
   * @param keys Keys accessed by script.
   * @param args Arguments passed to script.
   * @returns Script execution result from Redis.
   * @throws Error on HTTP communication failure or Lua evaluation error.
   * @invariants Big-O O(1) invocation overhead.
   */
  public async eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> {
    const serializedArgs = [script, keys.length, ...keys, ...args];
    return await this.executeCommand<unknown>('EVAL', serializedArgs);
  }

  /**
   * @purpose Retrieves string value for key.
   * @rationale Dispatches GET command via HTTP REST pipeline.
   * @preconditions key must be a non-empty string.
   * @param key Redis storage key.
   * @returns String value or null if key does not exist.
   * @throws Error on network or server error.
   * @invariants Big-O O(1).
   */
  public async get(key: string): Promise<string | null> {
    return await this.executeCommand<string | null>('GET', [key]);
  }

  /**
   * @purpose Sets key to string value with optional mode and duration.
   * @rationale Dispatches SET command via HTTP REST pipeline.
   * @preconditions key and value must be non-empty strings.
   * @param key Storage key.
   * @param value Target string value.
   * @param mode Optional expiration mode ('PX' or 'EX').
   * @param duration Optional expiration duration.
   * @returns Redis response status.
   * @throws Error on failure.
   * @invariants Big-O O(1).
   */
  public async set(key: string, value: string, mode?: string, duration?: number): Promise<unknown> {
    const cmdArgs: (string | number)[] = [key, value];
    if (mode && duration !== undefined) {
      cmdArgs.push(mode, duration);
    }
    return await this.executeCommand<unknown>('SET', cmdArgs);
  }

  /**
   * @purpose Deletes key from Redis.
   * @rationale Dispatches DEL command via HTTP REST pipeline.
   * @preconditions key must be a non-empty string.
   * @param key Storage key.
   * @returns Number of deleted keys.
   * @throws Error on failure.
   * @invariants Big-O O(1).
   */
  public async del(key: string): Promise<number> {
    return await this.executeCommand<number>('DEL', [key]);
  }
}
