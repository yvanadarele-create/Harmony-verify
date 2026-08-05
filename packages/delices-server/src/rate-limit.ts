/**
 * A fixed-window rate limiter, in memory.
 *
 * It exists to stop a form being hammered, not to survive a determined attacker —
 * single process, no shared store. Public writes and login attempts are the only
 * things it guards.
 */
export interface Limit {
  windowMs: number;
  max: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly limit: Limit) {}

  /** True when the caller is allowed to proceed. */
  take(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.limit.windowMs });
      this.sweep(now);
      return true;
    }
    if (entry.count >= this.limit.max) return false;
    entry.count += 1;
    return true;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private sweep(now: number): void {
    if (this.hits.size < 1000) return;
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) this.hits.delete(key);
    }
  }
}
