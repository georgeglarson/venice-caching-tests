/**
 * In-memory rate limiting middleware for Hono
 * Tracks requests per IP address with configurable windows and limits
 */

import type { Context, Next } from "hono";
import { getConnInfo } from "hono/bun";
import { SECURITY_CONSTANTS } from "../../config/constants.ts";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

interface RateLimitStats {
  totalIpsTracked: number;
  totalRequestsInWindow: number;
  oldestEntry: number | null;
  newestEntry: number | null;
}

class RateLimiter {
  private store: Map<string, RateLimitEntry> = new Map();
  private windowMs: number;
  private maxRequests: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(windowMs: number, maxRequests: number) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  /**
   * Check if a request from the given IP is allowed
   */
  check(ip: string): RateLimitCheckResult {
    const now = Date.now();
    const entry = this.store.get(ip);

    // No entry or expired window - create new entry
    if (!entry || now >= entry.resetAt) {
      const resetAt = now + this.windowMs;
      this.store.set(ip, { count: 1, resetAt });
      return {
        allowed: true,
        remaining: this.maxRequests - 1,
        resetAt,
      };
    }

    // Within existing window - increment count
    entry.count++;
    this.store.set(ip, entry);

    if (entry.count > this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.resetAt,
      };
    }

    return {
      allowed: true,
      remaining: this.maxRequests - entry.count,
      resetAt: entry.resetAt,
    };
  }

  /**
   * Remove expired entries from the store
   */
  cleanup(): void {
    const now = Date.now();
    for (const [ip, entry] of this.store.entries()) {
      if (now >= entry.resetAt) {
        this.store.delete(ip);
      }
    }
  }

  /**
   * Get current rate limit statistics
   */
  getStats(): RateLimitStats {
    let totalRequests = 0;
    let oldestEntry: number | null = null;
    let newestEntry: number | null = null;

    for (const entry of this.store.values()) {
      totalRequests += entry.count;
      const entryStart = entry.resetAt - this.windowMs;
      if (oldestEntry === null || entryStart < oldestEntry) {
        oldestEntry = entryStart;
      }
      if (newestEntry === null || entryStart > newestEntry) {
        newestEntry = entryStart;
      }
    }

    return {
      totalIpsTracked: this.store.size,
      totalRequestsInWindow: totalRequests,
      oldestEntry,
      newestEntry,
    };
  }

  /**
   * Start the cleanup interval
   */
  startCleanup(intervalMs: number): void {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => this.cleanup(), intervalMs);
  }

  /**
   * Stop the cleanup interval
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Singleton rate limiter instance
export const rateLimiter = new RateLimiter(
  SECURITY_CONSTANTS.RATE_LIMIT_WINDOW_MS,
  SECURITY_CONSTANTS.RATE_LIMIT_MAX_REQUESTS
);

// Start cleanup interval
rateLimiter.startCleanup(SECURITY_CONSTANTS.RATE_LIMIT_CLEANUP_INTERVAL_MS);

/**
 * Extract client IP from request context using Hono's getConnInfo for Bun
 * This returns the true peer IP from the TCP connection, which cannot be spoofed.
 */
function getClientIp(c: Context): string {
  const info = getConnInfo(c);
  return info.remote.address as string;
}

/**
 * Create rate limiting middleware
 */
export function createRateLimitMiddleware(bypassPaths: readonly string[] = []) {
  return async (c: Context, next: Next) => {
    if (bypassPaths.includes(c.req.path)) {
      await next();
      return;
    }

    const ip = getClientIp(c);
    const result = rateLimiter.check(ip);

    // Add rate limit headers
    c.header("X-RateLimit-Limit", String(SECURITY_CONSTANTS.RATE_LIMIT_MAX_REQUESTS));
    c.header("X-RateLimit-Remaining", String(result.remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
      c.header("Retry-After", String(retryAfter));
      return c.json(
        {
          error: "Rate limit exceeded",
          retryAfter,
        },
        429
      );
    }

    await next();
  };
}
