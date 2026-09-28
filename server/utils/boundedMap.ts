/**
 * A Map with a size cap (DEFECT-0055).
 *
 * Module-level Maps keyed by client-controlled values — an IP, an email, a
 * coordinate pair, a job id — grow for the life of the process. Each web
 * machine then leaks memory in proportion to distinct traffic, and a scanner
 * can drive it on purpose. BoundedMap is a drop-in replacement: writing a key
 * moves it to the newest position, and once the cap is exceeded the oldest
 * keys are evicted. Eviction is only ever the loss of a cache entry or a
 * per-key counter, so every caller must already tolerate a miss.
 */
export class BoundedMap<K, V> extends Map<K, V> {
  constructor(private readonly maxEntries: number) {
    super();
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error(`BoundedMap: maxEntries must be a positive integer, got ${maxEntries}`);
    }
  }

  override set(key: K, value: V): this {
    if (super.has(key)) super.delete(key);
    super.set(key, value);
    while (super.size > this.maxEntries) {
      const oldest = super.keys().next();
      if (oldest.done) break;
      super.delete(oldest.value);
    }
    return this;
  }
}
