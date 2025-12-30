/**
 * Cache wrapper for repository functions
 * Adds caching layer to expensive database queries
 */

import { memoryCache } from "./memory.ts";
import { CACHE_CONSTANTS } from "../config/constants.ts";
import {
  getDashboardStats,
  getModelStats,
  getModelSparklines,
} from "../db/repository.ts";
import type {
  DashboardStats,
  ModelStats,
  ModelSparklineData,
} from "../db/repository.ts";

export function getCachedDashboardStats(): DashboardStats {
  const cached = memoryCache.get<DashboardStats>(CACHE_CONSTANTS.STATS_CACHE_KEY);
  if (cached) {
    return cached;
  }

  const stats = getDashboardStats();
  memoryCache.set(CACHE_CONSTANTS.STATS_CACHE_KEY, stats);
  return stats;
}

export function getCachedModelStats(): ModelStats[] {
  const cached = memoryCache.get<ModelStats[]>(CACHE_CONSTANTS.MODELS_CACHE_KEY);
  if (cached) {
    return cached;
  }

  const stats = getModelStats();
  memoryCache.set(CACHE_CONSTANTS.MODELS_CACHE_KEY, stats);
  return stats;
}

export function getCachedModelSparklines(limit: number): ModelSparklineData[] {
  const cacheKey = `${CACHE_CONSTANTS.SPARKLINES_CACHE_KEY}:${limit}`;
  const cached = memoryCache.get<ModelSparklineData[]>(cacheKey);
  if (cached) {
    return cached;
  }

  const sparklines = getModelSparklines(limit);
  memoryCache.set(cacheKey, sparklines);
  return sparklines;
}

export function invalidateAllCaches(): void {
  memoryCache.invalidateAll();
}
