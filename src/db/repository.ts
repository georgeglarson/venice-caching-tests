/**
 * Simplified database repository - just save and query results
 */

import { getDatabase, initDatabase } from "./migrations.ts";
import type { TestResultRow } from "./schema.ts";
import type { TestResult } from "../core/types.ts";
import type { UsageInfo } from "../core/types.ts";
import { invalidateAllCaches } from "../cache/repository.ts";

// Initialize database and run migrations on first import
initDatabase();

// ============ Save Results ============

export function saveResult(result: TestResult, modelName?: string): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO test_results
    (model_id, model_name, test_name, caching_works, cache_hit_rate, details_json, error, test_run_id, cache_isolation_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    result.model,
    modelName || result.model,
    result.testName,
    result.cachingWorks ? 1 : 0,
    result.cacheHitRate,
    JSON.stringify(result.details),
    result.error || null,
    result.testRunId || null,
    result.cacheIsolationNote || null
  );

  // Invalidate all cached data since new results were added
  invalidateAllCaches();
}

// ============ Query Results ============

export function getRecentResults(limit = 100): TestResultRow[] {
  const db = getDatabase();
  return db
    .prepare(`
      SELECT * FROM test_results
      ORDER BY tested_at DESC
      LIMIT ?
    `)
    .all(limit) as TestResultRow[];
}

// ============ Computed Stats ============

export interface ModelStats {
  model_id: string;
  model_name: string | null;
  total_tests: number;
  successful_cache_tests: number;
  avg_cache_rate: number;
  avg_cache_rate_nonzero: number | null;
  tests_with_caching: number;
  best_cache_rate: number;
  worst_cache_rate: number;
  last_tested_at: string | null;
  cache_reliability_score: number;
}

export function getModelStats(): ModelStats[] {
  const db = getDatabase();
  return db
    .prepare(`
      SELECT
        model_id,
        model_name,
        COUNT(*) as total_tests,
        SUM(caching_works) as successful_cache_tests,
        AVG(cache_hit_rate) as avg_cache_rate,
        AVG(CASE WHEN cache_hit_rate > 0 THEN cache_hit_rate ELSE NULL END) as avg_cache_rate_nonzero,
        COUNT(CASE WHEN cache_hit_rate > 0 THEN 1 END) as tests_with_caching,
        MAX(cache_hit_rate) as best_cache_rate,
        MIN(cache_hit_rate) as worst_cache_rate,
        MAX(tested_at) as last_tested_at,
        (CAST(SUM(caching_works) AS REAL) / COUNT(*)) * 100 as cache_reliability_score
      FROM test_results
      GROUP BY model_id
      ORDER BY avg_cache_rate DESC NULLS LAST
    `)
    .all() as ModelStats[];
}

export interface DashboardStats {
  lastTestAt: string | null;
  totalTests: number;
  totalModels: number;
  modelsWithCaching: number;
  avgCacheRate: number;
  avgCacheRateNonzero: number | null;
  testsWithCaching: number;
}

export function getDashboardStats(): DashboardStats {
  const db = getDatabase();

  const lastTest = db
    .prepare("SELECT tested_at FROM test_results ORDER BY tested_at DESC LIMIT 1")
    .get() as { tested_at: string } | null;

  const stats = db
    .prepare(`
      SELECT
        COUNT(*) as total_tests,
        COUNT(DISTINCT model_id) as total_models,
        COUNT(DISTINCT CASE WHEN caching_works = 1 THEN model_id END) as models_with_caching,
        AVG(cache_hit_rate) as avg_rate,
        AVG(CASE WHEN cache_hit_rate > 0 THEN cache_hit_rate ELSE NULL END) as avg_rate_nonzero,
        COUNT(CASE WHEN cache_hit_rate > 0 THEN 1 END) as tests_with_caching
      FROM test_results
    `)
    .get() as { total_tests: number; total_models: number; models_with_caching: number; avg_rate: number | null; avg_rate_nonzero: number | null; tests_with_caching: number };

  return {
    lastTestAt: lastTest?.tested_at || null,
    totalTests: stats.total_tests,
    totalModels: stats.total_models,
    modelsWithCaching: stats.models_with_caching || 0,
    avgCacheRate: stats.avg_rate || 0,
    avgCacheRateNonzero: stats.avg_rate_nonzero || null,
    testsWithCaching: stats.tests_with_caching || 0,
  };
}

// ============ History for Charts ============

export interface TimeSeriesPoint {
  date: string;
  avgRate: number;
  avgRateNonzero: number | null;
  totalTests: number;
  testsWithCaching: number;
}

export function getHistory(days = 30): TimeSeriesPoint[] {
  const db = getDatabase();
  return db
    .prepare(`
      SELECT
        date(tested_at) as date,
        AVG(cache_hit_rate) as avgRate,
        AVG(CASE WHEN cache_hit_rate > 0 THEN cache_hit_rate ELSE NULL END) as avgRateNonzero,
        COUNT(*) as totalTests,
        COUNT(CASE WHEN cache_hit_rate > 0 THEN 1 END) as testsWithCaching
      FROM test_results
      WHERE tested_at >= datetime('now', '-' || ? || ' days')
      GROUP BY date(tested_at)
      ORDER BY date
    `)
    .all(days) as TimeSeriesPoint[];
}

// ============ Token Usage Tracking ============

export function recordTokenUsage(modelId: string, usage: UsageInfo): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO token_usage (model_id, prompt_tokens, cached_tokens, completion_tokens, diem_balance)
    VALUES (?, ?, ?, ?, ?)
  `).run(modelId, usage.promptTokens, usage.cachedTokens, usage.completionTokens, usage.diemBalance ?? null);
}

export interface UsageStats {
  totalPromptTokens: number;
  totalCachedTokens: number;
  totalCompletionTokens: number;
  totalRequests: number;
  tokensSaved: number;
  savingsPercent: number;
}

export interface DailyUsage {
  date: string;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  requests: number;
}

export function getUsageStats(days = 30): UsageStats {
  const db = getDatabase();
  const stats = db.prepare(`
    SELECT
      COALESCE(SUM(prompt_tokens), 0) as total_prompt,
      COALESCE(SUM(cached_tokens), 0) as total_cached,
      COALESCE(SUM(completion_tokens), 0) as total_completion,
      COUNT(*) as total_requests
    FROM token_usage
    WHERE recorded_at >= datetime('now', '-' || ? || ' days')
  `).get(days) as { total_prompt: number; total_cached: number; total_completion: number; total_requests: number };

  const totalPrompt = stats.total_prompt || 0;
  const totalCached = stats.total_cached || 0;

  return {
    totalPromptTokens: totalPrompt,
    totalCachedTokens: totalCached,
    totalCompletionTokens: stats.total_completion || 0,
    totalRequests: stats.total_requests || 0,
    tokensSaved: totalCached,
    savingsPercent: totalPrompt > 0 ? (totalCached / totalPrompt) * 100 : 0,
  };
}

export function getDailyUsage(days = 30): DailyUsage[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT
      date(recorded_at) as date,
      SUM(prompt_tokens) as promptTokens,
      SUM(cached_tokens) as cachedTokens,
      SUM(completion_tokens) as completionTokens,
      COUNT(*) as requests
    FROM token_usage
    WHERE recorded_at >= datetime('now', '-' || ? || ' days')
    GROUP BY date(recorded_at)
    ORDER BY date
  `).all(days) as DailyUsage[];
}

// ============ Data Retention / Cleanup ============

export interface CleanupResult {
  testResultsDeleted: number;
  tokenUsageDeleted: number;
}

/**
 * Delete records older than specified days to prevent unbounded growth.
 * Default retention: 30 days
 */
export function cleanupOldData(retentionDays = 30): CleanupResult {
  const db = getDatabase();

  // Delete old test results
  const testResultsResult = db.prepare(`
    DELETE FROM test_results
    WHERE tested_at < datetime('now', '-' || ? || ' days')
  `).run(retentionDays);

  // Delete old token usage records
  const tokenUsageResult = db.prepare(`
    DELETE FROM token_usage
    WHERE recorded_at < datetime('now', '-' || ? || ' days')
  `).run(retentionDays);

  return {
    testResultsDeleted: testResultsResult.changes,
    tokenUsageDeleted: tokenUsageResult.changes,
  };
}

// ============ Model Sparklines ============

export interface ModelSparklineData {
  model_id: string;
  rates: number[]; // Last N cache hit rates for sparkline
}

/**
 * Get recent cache rates for all models (for sparklines)
 * Returns last 10 rates per model, oldest to newest
 */
export function getModelSparklines(limit = 10): ModelSparklineData[] {
  const db = getDatabase();

  // Get recent results per model, grouped
  const results = db.prepare(`
    WITH ranked AS (
      SELECT
        model_id,
        cache_hit_rate,
        ROW_NUMBER() OVER (PARTITION BY model_id ORDER BY tested_at DESC) as rn
      FROM test_results
      WHERE cache_hit_rate IS NOT NULL
    )
    SELECT model_id, cache_hit_rate
    FROM ranked
    WHERE rn <= ?
    ORDER BY model_id, rn DESC
  `).all(limit) as Array<{ model_id: string; cache_hit_rate: number }>;

  // Group by model_id
  const grouped = new Map<string, number[]>();
  for (const row of results) {
    if (!grouped.has(row.model_id)) {
      grouped.set(row.model_id, []);
    }
    grouped.get(row.model_id)!.push(row.cache_hit_rate);
  }

  return Array.from(grouped.entries()).map(([model_id, rates]) => ({
    model_id,
    rates, // Already oldest to newest due to ORDER BY rn DESC
  }));
}
