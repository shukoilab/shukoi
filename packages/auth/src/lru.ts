/**
 * @purpose Bounded Least-Recently-Used (LRU) cache with size limits for authentication token caching.
 * @rationale Guarantees O(1) space complexity, preventing heap exhaustion under large token volumes.
 * @preconditions maxItems must be a positive integer.
 * @invariants Bounded size; eviction of oldest entry upon reaching capacity; Big-O O(1) get/set.
 */

/**
 * @purpose Bounded memory store mapping keys to values with LRU eviction.
 * @rationale Enforces hard memory boundaries on token introspection caching.
 * @preconditions maxItems must be positive integer.
 * @param maxItems Maximum allowed entries in the cache (default: 5000).
 * @returns Instantiated BoundedLruCache instance.
 * @throws Never throws during construction.
 * @invariants Map size <= maxItems at all times.
 */
export class BoundedLruCache<K, V> {
  private readonly maxItems: number;
  private readonly map = new Map<K, V>();

  public constructor(maxItems = 5000) {
    this.maxItems = maxItems;
  }

  /**
   * @purpose Retrieves entry and moves it to the most-recently-used position.
   * @rationale Implements LRU recency refresh upon access.
   * @preconditions Key must be valid lookup key.
   * @param key Entry lookup key.
   * @returns Value or undefined if absent.
   * @throws Never throws.
   * @invariants Big-O O(1).
   */
  public get(key: K): V | undefined {
    const item = this.map.get(key);
    if (item !== undefined) {
      this.map.delete(key);
      this.map.set(key, item);
    }
    return item;
  }

  /**
   * @purpose Inserts or updates an entry, evicting the oldest if at capacity.
   * @rationale Enforces strict upper bound on memory consumption.
   * @preconditions None.
   * @param key Entry key.
   * @param value Value to store.
   * @returns Void.
   * @throws Never throws.
   * @invariants Big-O O(1); size never exceeds maxItems.
   */
  public set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxItems) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, value);
  }

  /**
   * @purpose Returns current item count in the cache.
   * @rationale Enables inspecting memory buffer utilization and capacity.
   * @preconditions None.
   * @param None
   * @returns Non-negative integer count.
   * @throws Never throws.
   * @invariants Big-O O(1).
   */
  public get size(): number {
    return this.map.size;
  }

  /**
   * @purpose Clears all entries from the cache.
   * @rationale Resets cache storage during test teardown or memory flush.
   * @preconditions None.
   * @param None
   * @returns Void.
   * @throws Never throws.
   * @invariants Big-O O(1) map reset.
   */
  public clear(): void {
    this.map.clear();
  }
}
