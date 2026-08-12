/**
 * Supplier data caching and the offline fallback (§74, §75).
 *
 * Two requirements meet here.
 *
 * §75: cached supplier data carries a `lastChecked` timestamp, because supplier
 * prices and stock go stale and a system that forgets when it last looked will
 * quote yesterday's price with today's confidence.
 *
 * §74: when the supplier API is unavailable, Brandora keeps working from what it
 * already has rather than showing an empty catalogue. Stale data is *labelled*
 * internally and refreshed when the API returns.
 *
 * The design point worth stating: staleness is a property of an entry, not a
 * reason to delete it. An expired entry stays in the cache precisely so it can
 * be served during an outage — a fourteen-hour-old price is far more useful to a
 * founder than a spinner, as long as nobody mistakes it for live.
 */

export interface CacheEntry<T> {
  value: T;
  /** When this was fetched from the supplier. */
  fetchedAt: string;
  /** Which supplier it came from — the cache spans adapters. */
  source: string;
}

export interface CacheRead<T> {
  value: T;
  fetchedAt: string;
  source: string;
  /** Past its TTL. Serve it, label it, refresh it. */
  stale: boolean;
  ageMinutes: number;
}

export interface ClockOptions {
  now?: () => Date;
}

/**
 * In-memory implementation.
 *
 * Deliberately an interface plus a simple implementation rather than a Redis
 * client: the semantics above are the part that must be right, and swapping the
 * storage is then a class. A single-process cache is also correct for the MVP —
 * one server, one cache, no coherence problem to get wrong.
 */
export interface SupplierCache {
  get<T>(key: string, ttlMinutes: number): CacheRead<T> | undefined;
  set<T>(key: string, value: T, source: string): void;
  /** Every entry past its TTL, for the background refresh. */
  staleKeys(ttlMinutes: number): string[];
  delete(key: string): void;
  readonly size: number;
}

export class MemorySupplierCache implements SupplierCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly now: () => Date;

  constructor(options: ClockOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  private ageMinutes(fetchedAt: string): number {
    return (this.now().getTime() - new Date(fetchedAt).getTime()) / 60_000;
  }

  get<T>(key: string, ttlMinutes: number): CacheRead<T> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const ageMinutes = this.ageMinutes(entry.fetchedAt);
    return {
      value: entry.value as T,
      fetchedAt: entry.fetchedAt,
      source: entry.source,
      stale: ageMinutes > ttlMinutes,
      ageMinutes,
    };
  }

  set<T>(key: string, value: T, source: string): void {
    this.entries.set(key, { value, fetchedAt: this.now().toISOString(), source });
  }

  staleKeys(ttlMinutes: number): string[] {
    return [...this.entries.entries()]
      .filter(([, entry]) => this.ageMinutes(entry.fetchedAt) > ttlMinutes)
      .map(([key]) => key);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}

export interface FreshnessLabel {
  /** True when the data came from a live call in this request. */
  live: boolean;
  fetchedAt: string;
  ageMinutes: number;
  /** Admin-facing wording. Customers see the localised `sourcing.stale` string. */
  note: string;
}

export function freshness(read: CacheRead<unknown> | undefined, live: boolean): FreshnessLabel {
  if (live || !read) {
    const at = read?.fetchedAt ?? new Date().toISOString();
    return { live: true, fetchedAt: at, ageMinutes: 0, note: "Live from the supplier" };
  }
  return {
    live: false,
    fetchedAt: read.fetchedAt,
    ageMinutes: Math.round(read.ageMinutes),
    note: read.stale
      ? `Cached ${Math.round(read.ageMinutes)} minutes ago and past its refresh window — the supplier API was unavailable`
      : `Cached ${Math.round(read.ageMinutes)} minutes ago`,
  };
}

/**
 * Run a supplier call with the cache in front and behind it.
 *
 * Fresh cache short-circuits. A live call refreshes. A failed live call falls
 * back to whatever is cached, however old — and reports that it did, so the
 * caller can label it rather than passing it off as current.
 */
export async function withCache<T>(
  cache: SupplierCache,
  key: string,
  ttlMinutes: number,
  source: string,
  fetcher: () => Promise<T>,
): Promise<{ value: T; freshness: FreshnessLabel }> {
  const cached = cache.get<T>(key, ttlMinutes);
  if (cached && !cached.stale) {
    return { value: cached.value, freshness: freshness(cached, false) };
  }

  try {
    const value = await fetcher();
    cache.set(key, value, source);
    return { value, freshness: freshness(cache.get<T>(key, ttlMinutes), true) };
  } catch (err) {
    if (cached) return { value: cached.value, freshness: freshness(cached, false) };
    throw err;
  }
}
