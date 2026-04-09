/**
 * Token bucket rate limiter.
 * Refills tokens proportionally based on elapsed time.
 */
export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private windowMs: number;
  private lastRefill: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxTokens = maxRequests;
    this.tokens = maxRequests;
    this.windowMs = windowMs;
    this.lastRefill = Date.now();
  }

  /** Try to consume one token. Returns true if acquired. */
  tryAcquire(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Get ms until the next token becomes available */
  getWaitTime(): number {
    this.refill();
    if (this.tokens >= 1) return 0;

    const tokensNeeded = 1 - this.tokens;
    const msPerToken = this.windowMs / this.maxTokens;
    return Math.ceil(tokensNeeded * msPerToken);
  }

  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }

  /** Adjust rate based on Reddit's response headers.
   * Flushes elapsed time at the current rate before changing the window,
   * so historical time is credited correctly. */
  updateFromHeaders(remaining: number, resetSeconds: number): void {
    this.refill(); // credit elapsed time at current rate before changing window

    // Trust the server's count as authoritative — allow both raising and lowering.
    // Floor at 0: Reddit can return negative remaining under aggressive rate limiting.
    this.tokens = Math.max(0, Math.min(remaining, this.maxTokens));

    if (resetSeconds > 0) {
      // Cap at 10 minutes to prevent a malformed header from stalling the queue
      this.windowMs = Math.min(resetSeconds, 600) * 1000;
    }

    // Anchor refill clock to now so next refill() doesn't re-add tokens on top of server count
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;

    if (elapsed > 0) {
      const tokensToAdd = (elapsed / this.windowMs) * this.maxTokens;
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }
}
