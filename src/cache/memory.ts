/**
 * In-memory TTL-based cache module
 * Provides a generic caching layer with expiration timestamps
 */

import { CACHE_CONSTANTS } from "../config/constants.ts";

// Lazy import to avoid circular dependency
// metricsCollector imports from config/constants which doesn't import cache
let metricsCollectorModule: typeof import("../metrics/collector.ts") | null = null;
async function getMetricsCollector() {
  if (!metricsCollectorModule) {
    metricsCollectorModule = await import("../metrics/collector.ts");
  }
  return metricsCollectorModule.metricsCollector;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class MemoryCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private hits = 0;
  private misses = 0;
  private defaultTtlMs: number;

  constructor(defaultTtlMs: number = CACHE_CONSTANTS.DEFAULT_TTL_MS) {
    this.defaultTtlMs = defaultTtlMs;
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      // Record cache miss asynchronously to avoid blocking
      getMetricsCollector().then(mc => mc.recordCacheMiss(key)).catch(() => {});
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      // Record cache miss asynchronously to avoid blocking
      getMetricsCollector().then(mc => mc.recordCacheMiss(key)).catch(() => {});
      return null;
    }

    this.hits++;
    // Record cache hit asynchronously to avoid blocking
    getMetricsCollector().then(mc => mc.recordCacheHit(key)).catch(() => {});
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTtlMs;
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    });
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  getStats(): {
    hits: number;
    misses: number;
    size: number;
    hitRate: number;
  } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRate: total > 0 ? (this.hits / total) * 100 : 0,
    };
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

export const memoryCache = new MemoryCache();
