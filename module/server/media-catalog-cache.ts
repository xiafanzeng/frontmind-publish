/** Bounded process-memory cache; pending requests share a promise, failures never stick.
 * TTL begins on successful completion so a slow in-flight request cannot expire itself.
 * Keys must include the repository's complete result scope and catalog identity.
 */
export class MediaCatalogPromiseCache<T> {
  private readonly entries = new Map<string, { expiresAt: number; pending: boolean; value: Promise<T> }>();

  constructor(private readonly capacity = 12, private readonly ttlMs = 60_000) {}

  getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    for (const [entryKey, entry] of this.entries) {
      if (!entry.pending && entry.expiresAt <= now) this.entries.delete(entryKey);
    }
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.value;
    }
    while (this.entries.size >= this.capacity) {
      // Prefer evicting a completed result; keep shared in-flight work where possible.
      const settled = [...this.entries].find(([, entry]) => !entry.pending)?.[0];
      const oldest = settled ?? this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    const entry = { expiresAt: Infinity, pending: true, value: undefined as unknown as Promise<T> };
    entry.value = Promise.resolve().then(load).then((value) => {
      entry.pending = false;
      entry.expiresAt = Date.now() + this.ttlMs;
      return value;
    }, (error: unknown) => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, entry);
    return entry.value;
  }

  delete(key: string) { this.entries.delete(key); }
  clear() { this.entries.clear(); }
}
