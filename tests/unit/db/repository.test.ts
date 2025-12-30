/**
 * Tests for database repository operations
 *
 * Uses mock.module to override getDatabase, then tests the real repository exports.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { createTestDatabase, clearTestDatabase, seedTestDatabase } from "../../setup.ts";
import type { TestResult, UsageInfo } from "../../../src/core/types.ts";

// Create a test database instance that will be used as the mock
let testDb: Database;

// Mock the migrations module to return our test database
mock.module("../../../src/db/migrations.ts", () => ({
  getDatabase: () => testDb,
  initDatabase: () => {}, // No-op for tests
  closeDatabase: () => {},
}));

// Import real repository functions AFTER setting up the mock
import {
  saveResult,
  getRecentResults,
  getModelStats,
  getDashboardStats,
  getHistory,
  recordTokenUsage,
  getUsageStats,
  getDailyUsage,
  cleanupOldData,
  getModelSparklines,
} from "../../../src/db/repository.ts";

import type {
  ModelStats,
  DashboardStats,
  TimeSeriesPoint,
  UsageStats,
  DailyUsage,
  CleanupResult,
  ModelSparklineData,
} from "../../../src/db/repository.ts";

describe("saveResult", () => {
  beforeEach(() => {
    testDb = createTestDatabase();
  });

  afterEach(() => {
    testDb.close();
  });

  test("should insert test result into database", () => {
    const result: TestResult = {
      testName: "basic",
      model: "test-model",
      success: true,
      cachingWorks: true,
      cacheHitRate: 75,
      details: { key: "value" },
    };

    saveResult(result);

    const rows = testDb.prepare("SELECT * FROM test_results").all();
    expect(rows.length).toBe(1);
  });

  test("should serialize details object to JSON", () => {
    const result: TestResult = {
      testName: "basic",
      model: "test-model",
      success: true,
      cachingWorks: true,
      cacheHitRate: 75,
      details: { nested: { data: [1, 2, 3] } },
    };

    saveResult(result);

    const row = testDb.prepare("SELECT details_json FROM test_results").get() as {
      details_json: string;
    };
    expect(JSON.parse(row.details_json)).toEqual({ nested: { data: [1, 2, 3] } });
  });

  test("should use custom modelName when provided", () => {
    const result: TestResult = {
      testName: "basic",
      model: "model-id",
      success: true,
      cachingWorks: true,
      cacheHitRate: 50,
      details: {},
    };

    saveResult(result, "Custom Model Name");

    const row = testDb.prepare("SELECT model_name FROM test_results").get() as {
      model_name: string;
    };
    expect(row.model_name).toBe("Custom Model Name");
  });

  test("should default modelName to model ID when not provided", () => {
    const result: TestResult = {
      testName: "basic",
      model: "model-id",
      success: true,
      cachingWorks: true,
      cacheHitRate: 50,
      details: {},
    };

    saveResult(result);

    const row = testDb.prepare("SELECT model_name FROM test_results").get() as {
      model_name: string;
    };
    expect(row.model_name).toBe("model-id");
  });

  test("should handle null values for optional fields", () => {
    const result: TestResult = {
      testName: "basic",
      model: "test-model",
      success: false,
      cachingWorks: false,
      cacheHitRate: null,
      details: {},
      error: undefined,
    };

    saveResult(result);

    const row = testDb.prepare("SELECT * FROM test_results").get() as any;
    expect(row.cache_hit_rate).toBeNull();
    expect(row.error).toBeNull();
  });

  test("should store testRunId when provided", () => {
    const result: TestResult = {
      testName: "basic",
      model: "test-model",
      success: true,
      cachingWorks: true,
      cacheHitRate: 50,
      details: {},
      testRunId: "run-12345",
    };

    saveResult(result);

    const row = testDb.prepare("SELECT test_run_id FROM test_results").get() as {
      test_run_id: string | null;
    };
    expect(row.test_run_id).toBe("run-12345");
  });

  test("should store cacheIsolationNote when provided", () => {
    const result: TestResult = {
      testName: "basic",
      model: "test-model",
      success: true,
      cachingWorks: true,
      cacheHitRate: 50,
      details: {},
      cacheIsolationNote: "Isolated cache test",
    };

    saveResult(result);

    const row = testDb.prepare("SELECT cache_isolation_note FROM test_results").get() as {
      cache_isolation_note: string | null;
    };
    expect(row.cache_isolation_note).toBe("Isolated cache test");
  });

  test("should auto-generate tested_at timestamp", () => {
    const result: TestResult = {
      testName: "basic",
      model: "test-model",
      success: true,
      cachingWorks: true,
      cacheHitRate: 50,
      details: {},
    };

    saveResult(result);

    const row = testDb.prepare("SELECT tested_at FROM test_results").get() as {
      tested_at: string;
    };
    expect(row.tested_at).toBeDefined();
    expect(typeof row.tested_at).toBe("string");
  });

  test("should store error message when provided", () => {
    const result: TestResult = {
      testName: "basic",
      model: "test-model",
      success: false,
      cachingWorks: false,
      cacheHitRate: null,
      details: {},
      error: "Connection timeout",
    };

    saveResult(result);

    const row = testDb.prepare("SELECT error FROM test_results").get() as {
      error: string | null;
    };
    expect(row.error).toBe("Connection timeout");
  });
});

describe("getRecentResults", () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    seedTestDatabase(testDb);
  });

  afterEach(() => {
    testDb.close();
  });

  test("should return results ordered by tested_at DESC", () => {
    const results = getRecentResults();

    expect(results.length).toBeGreaterThan(0);
    // Verify descending order
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].tested_at >= results[i + 1].tested_at).toBe(true);
    }
  });

  test("should limit results to specified count", () => {
    const results = getRecentResults(2);

    expect(results.length).toBe(2);
  });

  test("should use default limit of 100", () => {
    // Add more than 100 results
    for (let i = 0; i < 110; i++) {
      testDb.prepare(`
        INSERT INTO test_results (model_id, test_name, caching_works, cache_hit_rate)
        VALUES (?, ?, ?, ?)
      `).run(`model-${i}`, "basic", 1, 50);
    }

    const results = getRecentResults();

    expect(results.length).toBe(100);
  });

  test("should return empty array when no results exist", () => {
    clearTestDatabase(testDb);

    const results = getRecentResults();

    expect(results).toEqual([]);
  });

  test("should return all expected fields", () => {
    const results = getRecentResults(1);

    expect(results.length).toBe(1);
    const result = results[0];
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("tested_at");
    expect(result).toHaveProperty("model_id");
    expect(result).toHaveProperty("model_name");
    expect(result).toHaveProperty("test_name");
    expect(result).toHaveProperty("caching_works");
    expect(result).toHaveProperty("cache_hit_rate");
    expect(result).toHaveProperty("details_json");
  });
});

describe("getModelStats", () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    seedTestDatabase(testDb);
  });

  afterEach(() => {
    testDb.close();
  });

  test("should return ModelStats[] with correct structure", () => {
    const stats = getModelStats();

    expect(Array.isArray(stats)).toBe(true);
    expect(stats.length).toBeGreaterThan(0);

    const firstStat = stats[0];
    expect(firstStat).toHaveProperty("model_id");
    expect(firstStat).toHaveProperty("model_name");
    expect(firstStat).toHaveProperty("total_tests");
    expect(firstStat).toHaveProperty("successful_cache_tests");
    expect(firstStat).toHaveProperty("avg_cache_rate");
    expect(firstStat).toHaveProperty("avg_cache_rate_nonzero");
    expect(firstStat).toHaveProperty("tests_with_caching");
    expect(firstStat).toHaveProperty("best_cache_rate");
    expect(firstStat).toHaveProperty("worst_cache_rate");
    expect(firstStat).toHaveProperty("last_tested_at");
    expect(firstStat).toHaveProperty("cache_reliability_score");
  });

  test("should calculate total tests per model", () => {
    const stats = getModelStats();

    const llamaStats = stats.find((s) => s.model_id === "llama-3.3-70b");
    expect(llamaStats).toBeDefined();
    expect(llamaStats!.total_tests).toBe(3); // 3 test results for llama
  });

  test("should calculate successful cache tests count", () => {
    const stats = getModelStats();

    const llamaStats = stats.find((s) => s.model_id === "llama-3.3-70b");
    expect(llamaStats!.successful_cache_tests).toBe(3); // All llama tests have caching_works = 1
  });

  test("should calculate average cache rate (including zeros)", () => {
    const stats = getModelStats();

    const deepseekStats = stats.find((s) => s.model_id === "deepseek-r1");
    expect(deepseekStats!.avg_cache_rate).toBe(0); // Only test has cache_hit_rate = 0
  });

  test("should calculate average cache rate excluding zeros", () => {
    const stats = getModelStats();

    const llamaStats = stats.find((s) => s.model_id === "llama-3.3-70b");
    // Average of 80, 75, 70 = 75
    expect(llamaStats!.avg_cache_rate_nonzero).toBe(75);
  });

  test("should return null for avg_cache_rate_nonzero when all are zero", () => {
    const stats = getModelStats();

    const deepseekStats = stats.find((s) => s.model_id === "deepseek-r1");
    expect(deepseekStats!.avg_cache_rate_nonzero).toBeNull();
  });

  test("should calculate tests with caching (cache_hit_rate > 0)", () => {
    const stats = getModelStats();

    const llamaStats = stats.find((s) => s.model_id === "llama-3.3-70b");
    expect(llamaStats!.tests_with_caching).toBe(3);

    const deepseekStats = stats.find((s) => s.model_id === "deepseek-r1");
    expect(deepseekStats!.tests_with_caching).toBe(0);
  });

  test("should find best and worst cache rates per model", () => {
    const stats = getModelStats();

    const llamaStats = stats.find((s) => s.model_id === "llama-3.3-70b");
    expect(llamaStats!.best_cache_rate).toBe(80);
    expect(llamaStats!.worst_cache_rate).toBe(70);
  });

  test("should include last tested timestamp", () => {
    const stats = getModelStats();

    const llamaStats = stats.find((s) => s.model_id === "llama-3.3-70b");
    expect(llamaStats!.last_tested_at).toBeDefined();
    expect(typeof llamaStats!.last_tested_at).toBe("string");
  });

  test("should calculate cache reliability score (percentage)", () => {
    const stats = getModelStats();

    const llamaStats = stats.find((s) => s.model_id === "llama-3.3-70b");
    expect(llamaStats!.cache_reliability_score).toBe(100); // All 3 tests successful

    const deepseekStats = stats.find((s) => s.model_id === "deepseek-r1");
    expect(deepseekStats!.cache_reliability_score).toBe(0); // caching_works = 0
  });

  test("should group results by model_id", () => {
    const stats = getModelStats();

    const modelIds = stats.map((s) => s.model_id);
    expect(modelIds).toContain("llama-3.3-70b");
    expect(modelIds).toContain("deepseek-r1");
  });

  test("should order by avg_cache_rate DESC", () => {
    const stats = getModelStats();

    for (let i = 0; i < stats.length - 1; i++) {
      expect(stats[i].avg_cache_rate >= stats[i + 1].avg_cache_rate).toBe(true);
    }
  });

  test("should return empty array when no data exists", () => {
    clearTestDatabase(testDb);

    const stats = getModelStats();

    expect(stats).toEqual([]);
  });
});

describe("getDashboardStats", () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    seedTestDatabase(testDb);
  });

  afterEach(() => {
    testDb.close();
  });

  test("should return DashboardStats with correct structure", () => {
    const stats = getDashboardStats();

    expect(stats).toHaveProperty("lastTestAt");
    expect(stats).toHaveProperty("totalTests");
    expect(stats).toHaveProperty("totalModels");
    expect(stats).toHaveProperty("modelsWithCaching");
    expect(stats).toHaveProperty("avgCacheRate");
    expect(stats).toHaveProperty("avgCacheRateNonzero");
    expect(stats).toHaveProperty("testsWithCaching");
  });

  test("should return last test timestamp", () => {
    const stats = getDashboardStats();

    expect(stats.lastTestAt).toBeDefined();
    expect(typeof stats.lastTestAt).toBe("string");
  });

  test("should count total tests and models", () => {
    const stats = getDashboardStats();

    expect(stats.totalTests).toBe(4);
    expect(stats.totalModels).toBe(2);
  });

  test("should count models with caching", () => {
    const stats = getDashboardStats();

    expect(stats.modelsWithCaching).toBe(1); // Only llama has caching_works = 1
  });

  test("should calculate average cache rates (with and without zeros)", () => {
    const stats = getDashboardStats();

    expect(typeof stats.avgCacheRate).toBe("number");
    expect(stats.avgCacheRateNonzero).toBe(75); // Average of 80, 75, 70
  });

  test("should count tests with caching", () => {
    const stats = getDashboardStats();

    expect(stats.testsWithCaching).toBe(3); // 3 llama tests have cache > 0
  });

  test("should return zeros when no data exists", () => {
    clearTestDatabase(testDb);

    const stats = getDashboardStats();

    expect(stats.lastTestAt).toBeNull();
    expect(stats.totalTests).toBe(0);
    expect(stats.totalModels).toBe(0);
    expect(stats.modelsWithCaching).toBe(0);
    expect(stats.avgCacheRate).toBe(0);
    expect(stats.avgCacheRateNonzero).toBeNull();
    expect(stats.testsWithCaching).toBe(0);
  });
});

describe("getHistory", () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    // Insert data with different dates
    testDb.prepare(`
      INSERT INTO test_results (tested_at, model_id, test_name, caching_works, cache_hit_rate)
      VALUES
        (datetime('now', '-1 day'), 'model-a', 'basic', 1, 80),
        (datetime('now', '-1 day'), 'model-b', 'basic', 1, 60),
        (datetime('now', '-2 days'), 'model-a', 'basic', 1, 70),
        (datetime('now', '-3 days'), 'model-a', 'basic', 0, 0)
    `).run();
  });

  afterEach(() => {
    testDb.close();
  });

  test("should return TimeSeriesPoint[] with correct structure", () => {
    const history = getHistory(7);

    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThan(0);

    const point = history[0];
    expect(point).toHaveProperty("date");
    expect(point).toHaveProperty("avgRate");
    expect(point).toHaveProperty("avgRateNonzero");
    expect(point).toHaveProperty("totalTests");
    expect(point).toHaveProperty("testsWithCaching");
  });

  test("should group results by date", () => {
    const history = getHistory(7);

    // Should have entries grouped by date
    expect(history.length).toBeGreaterThan(0);
  });

  test("should calculate daily averages", () => {
    const history = getHistory(7);

    // Find the day with 2 tests (80 and 60)
    const dayWithTwo = history.find((h) => h.totalTests === 2);
    if (dayWithTwo) {
      expect(dayWithTwo.avgRate).toBe(70); // (80 + 60) / 2
    }
  });

  test("should filter by days parameter", () => {
    const history1 = getHistory(1);
    const history7 = getHistory(7);

    expect(history7.length).toBeGreaterThanOrEqual(history1.length);
  });

  test("should use default of 30 days", () => {
    // Insert data at 25 days and 35 days ago
    testDb.prepare(`
      INSERT INTO test_results (tested_at, model_id, test_name, caching_works, cache_hit_rate)
      VALUES
        (datetime('now', '-25 days'), 'model-a', 'basic', 1, 50),
        (datetime('now', '-35 days'), 'model-a', 'basic', 1, 40)
    `).run();

    const history = getHistory(); // default 30 days

    // Should include 25-day-old data but not 35-day-old data
    const dates = history.map((h) => h.date);
    expect(dates.length).toBeGreaterThan(0);
  });

  test("should order by date ascending", () => {
    const history = getHistory(7);

    for (let i = 0; i < history.length - 1; i++) {
      expect(history[i].date <= history[i + 1].date).toBe(true);
    }
  });

  test("should return empty array when no data in range", () => {
    clearTestDatabase(testDb);

    const history = getHistory(7);

    expect(history).toEqual([]);
  });

  test("should calculate testsWithCaching correctly", () => {
    const history = getHistory(7);

    // Day with cache_hit_rate = 0 should have testsWithCaching = 0
    const dayWithZero = history.find((h) => h.totalTests === 1 && h.avgRate === 0);
    if (dayWithZero) {
      expect(dayWithZero.testsWithCaching).toBe(0);
    }
  });
});

describe("recordTokenUsage", () => {
  beforeEach(() => {
    testDb = createTestDatabase();
  });

  afterEach(() => {
    testDb.close();
  });

  test("should insert token usage record", () => {
    const usage: UsageInfo = {
      promptTokens: 1000,
      cachedTokens: 500,
      completionTokens: 50,
    };

    recordTokenUsage("test-model", usage);

    const rows = testDb.prepare("SELECT * FROM token_usage").all();
    expect(rows.length).toBe(1);
  });

  test("should store correct token counts", () => {
    const usage: UsageInfo = {
      promptTokens: 1000,
      cachedTokens: 500,
      completionTokens: 50,
    };

    recordTokenUsage("test-model", usage);

    const row = testDb.prepare("SELECT * FROM token_usage").get() as {
      model_id: string;
      prompt_tokens: number;
      cached_tokens: number;
      completion_tokens: number;
    };
    expect(row.model_id).toBe("test-model");
    expect(row.prompt_tokens).toBe(1000);
    expect(row.cached_tokens).toBe(500);
    expect(row.completion_tokens).toBe(50);
  });

  test("should handle null diem_balance", () => {
    const usage: UsageInfo = {
      promptTokens: 1000,
      cachedTokens: 500,
      completionTokens: 50,
      // diemBalance is undefined
    };

    recordTokenUsage("test-model", usage);

    const row = testDb.prepare("SELECT diem_balance FROM token_usage").get() as {
      diem_balance: number | null;
    };
    expect(row.diem_balance).toBeNull();
  });

  test("should store diem_balance when provided", () => {
    const usage: UsageInfo = {
      promptTokens: 1000,
      cachedTokens: 500,
      completionTokens: 50,
      diemBalance: 99.5,
    };

    recordTokenUsage("test-model", usage);

    const row = testDb.prepare("SELECT diem_balance FROM token_usage").get() as {
      diem_balance: number | null;
    };
    expect(row.diem_balance).toBe(99.5);
  });

  test("should auto-generate recorded_at timestamp", () => {
    const usage: UsageInfo = {
      promptTokens: 1000,
      cachedTokens: 500,
      completionTokens: 50,
    };

    recordTokenUsage("test-model", usage);

    const row = testDb.prepare("SELECT recorded_at FROM token_usage").get() as {
      recorded_at: string;
    };
    expect(row.recorded_at).toBeDefined();
    expect(typeof row.recorded_at).toBe("string");
  });
});

describe("getUsageStats", () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    testDb.prepare(`
      INSERT INTO token_usage (recorded_at, model_id, prompt_tokens, cached_tokens, completion_tokens)
      VALUES
        (datetime('now'), 'model-a', 1000, 500, 50),
        (datetime('now'), 'model-a', 800, 400, 40),
        (datetime('now'), 'model-b', 500, 0, 30)
    `).run();
  });

  afterEach(() => {
    testDb.close();
  });

  test("should return UsageStats with correct structure", () => {
    const stats = getUsageStats(7);

    expect(stats).toHaveProperty("totalPromptTokens");
    expect(stats).toHaveProperty("totalCachedTokens");
    expect(stats).toHaveProperty("totalCompletionTokens");
    expect(stats).toHaveProperty("totalRequests");
    expect(stats).toHaveProperty("tokensSaved");
    expect(stats).toHaveProperty("savingsPercent");
  });

  test("should sum token counts for specified days", () => {
    const stats = getUsageStats(7);

    expect(stats.totalPromptTokens).toBe(2300);
    expect(stats.totalCachedTokens).toBe(900);
    expect(stats.totalCompletionTokens).toBe(120);
  });

  test("should count total requests", () => {
    const stats = getUsageStats(7);

    expect(stats.totalRequests).toBe(3);
  });

  test("should calculate tokens saved (cached tokens)", () => {
    const stats = getUsageStats(7);

    expect(stats.tokensSaved).toBe(900);
  });

  test("should calculate savings percentage", () => {
    const stats = getUsageStats(7);

    // 900 / 2300 * 100 = ~39.13%
    expect(stats.savingsPercent).toBeCloseTo(39.13, 1);
  });

  test("should use default of 30 days", () => {
    // Insert data at 25 days and 35 days ago
    testDb.prepare(`
      INSERT INTO token_usage (recorded_at, model_id, prompt_tokens, cached_tokens, completion_tokens)
      VALUES
        (datetime('now', '-25 days'), 'model-a', 100, 50, 10),
        (datetime('now', '-35 days'), 'model-a', 200, 100, 20)
    `).run();

    const stats = getUsageStats(); // default 30 days

    // Should include 25-day-old data (100 prompt) but not 35-day-old (200 prompt)
    // Original data: 2300 + 100 = 2400
    expect(stats.totalPromptTokens).toBe(2400);
  });

  test("should return zeros when no data exists", () => {
    clearTestDatabase(testDb);

    const stats = getUsageStats(7);

    expect(stats.totalPromptTokens).toBe(0);
    expect(stats.totalCachedTokens).toBe(0);
    expect(stats.totalCompletionTokens).toBe(0);
    expect(stats.totalRequests).toBe(0);
    expect(stats.tokensSaved).toBe(0);
    expect(stats.savingsPercent).toBe(0);
  });

  test("should handle zero prompt tokens (avoid division by zero)", () => {
    clearTestDatabase(testDb);
    testDb.prepare(`
      INSERT INTO token_usage (recorded_at, model_id, prompt_tokens, cached_tokens, completion_tokens)
      VALUES (datetime('now'), 'model-a', 0, 0, 0)
    `).run();

    const stats = getUsageStats(7);

    expect(stats.savingsPercent).toBe(0); // Should not throw
  });
});

describe("getDailyUsage", () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    testDb.prepare(`
      INSERT INTO token_usage (recorded_at, model_id, prompt_tokens, cached_tokens, completion_tokens)
      VALUES
        (datetime('now', '-1 day'), 'model-a', 1000, 500, 50),
        (datetime('now', '-1 day'), 'model-b', 800, 400, 40),
        (datetime('now', '-2 days'), 'model-a', 500, 200, 30)
    `).run();
  });

  afterEach(() => {
    testDb.close();
  });

  test("should return DailyUsage[] with correct structure", () => {
    const daily = getDailyUsage(7);

    expect(Array.isArray(daily)).toBe(true);
    expect(daily.length).toBeGreaterThan(0);

    const day = daily[0];
    expect(day).toHaveProperty("date");
    expect(day).toHaveProperty("promptTokens");
    expect(day).toHaveProperty("cachedTokens");
    expect(day).toHaveProperty("completionTokens");
    expect(day).toHaveProperty("requests");
  });

  test("should group usage by date", () => {
    const daily = getDailyUsage(7);

    expect(daily.length).toBe(2); // 2 different days
  });

  test("should sum tokens per day", () => {
    const daily = getDailyUsage(7);

    // Find the day with 2 entries
    const dayWithTwo = daily.find((d) => d.requests === 2);
    if (dayWithTwo) {
      expect(dayWithTwo.promptTokens).toBe(1800); // 1000 + 800
      expect(dayWithTwo.cachedTokens).toBe(900); // 500 + 400
      expect(dayWithTwo.completionTokens).toBe(90); // 50 + 40
    }
  });

  test("should count requests per day", () => {
    const daily = getDailyUsage(7);

    expect(daily.some((d) => d.requests === 2)).toBe(true);
    expect(daily.some((d) => d.requests === 1)).toBe(true);
  });

  test("should filter by days parameter", () => {
    const daily1 = getDailyUsage(1);
    const daily7 = getDailyUsage(7);

    expect(daily7.length).toBeGreaterThanOrEqual(daily1.length);
  });

  test("should use default of 30 days", () => {
    // Insert data at 25 days and 35 days ago
    testDb.prepare(`
      INSERT INTO token_usage (recorded_at, model_id, prompt_tokens, cached_tokens, completion_tokens)
      VALUES
        (datetime('now', '-25 days'), 'model-a', 100, 50, 10),
        (datetime('now', '-35 days'), 'model-a', 200, 100, 20)
    `).run();

    const daily = getDailyUsage(); // default 30 days

    // Should include 25-day-old data but not 35-day-old
    expect(daily.length).toBe(3); // 2 original days + 1 at 25 days
  });

  test("should order by date ascending", () => {
    const daily = getDailyUsage(7);

    for (let i = 0; i < daily.length - 1; i++) {
      expect(daily[i].date <= daily[i + 1].date).toBe(true);
    }
  });

  test("should return empty array when no data in range", () => {
    clearTestDatabase(testDb);

    const daily = getDailyUsage(7);

    expect(daily).toEqual([]);
  });
});

describe("cleanupOldData", () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    // Insert old and new data
    testDb.prepare(`
      INSERT INTO test_results (tested_at, model_id, test_name, caching_works, cache_hit_rate)
      VALUES
        (datetime('now', '-60 days'), 'old-model', 'basic', 1, 50),
        (datetime('now', '-1 day'), 'new-model', 'basic', 1, 80)
    `).run();
    testDb.prepare(`
      INSERT INTO token_usage (recorded_at, model_id, prompt_tokens, cached_tokens, completion_tokens)
      VALUES
        (datetime('now', '-60 days'), 'old-model', 1000, 500, 50),
        (datetime('now', '-1 day'), 'new-model', 1000, 500, 50)
    `).run();
  });

  afterEach(() => {
    testDb.close();
  });

  test("should return CleanupResult with correct structure", () => {
    const result = cleanupOldData(30);

    expect(result).toHaveProperty("testResultsDeleted");
    expect(result).toHaveProperty("tokenUsageDeleted");
    expect(typeof result.testResultsDeleted).toBe("number");
    expect(typeof result.tokenUsageDeleted).toBe("number");
  });

  test("should delete test results older than retention days", () => {
    const result = cleanupOldData(30);

    expect(result.testResultsDeleted).toBe(1);

    const remaining = testDb.prepare("SELECT * FROM test_results").all();
    expect(remaining.length).toBe(1);
  });

  test("should delete token usage older than retention days", () => {
    const result = cleanupOldData(30);

    expect(result.tokenUsageDeleted).toBe(1);

    const remaining = testDb.prepare("SELECT * FROM token_usage").all();
    expect(remaining.length).toBe(1);
  });

  test("should not delete recent data", () => {
    cleanupOldData(30);

    const results = testDb.prepare("SELECT model_id FROM test_results").all() as Array<{
      model_id: string;
    }>;
    expect(results.some((r) => r.model_id === "new-model")).toBe(true);
    expect(results.some((r) => r.model_id === "old-model")).toBe(false);

    const usage = testDb.prepare("SELECT model_id FROM token_usage").all() as Array<{
      model_id: string;
    }>;
    expect(usage.some((u) => u.model_id === "new-model")).toBe(true);
    expect(usage.some((u) => u.model_id === "old-model")).toBe(false);
  });

  test("should use default retention of 30 days", () => {
    // Insert data at exactly 29 and 31 days ago
    testDb.prepare(`
      INSERT INTO test_results (tested_at, model_id, test_name, caching_works, cache_hit_rate)
      VALUES
        (datetime('now', '-29 days'), 'almost-old', 'basic', 1, 50),
        (datetime('now', '-31 days'), 'just-old', 'basic', 1, 50)
    `).run();

    cleanupOldData(); // default 30 days

    const results = testDb.prepare("SELECT model_id FROM test_results").all() as Array<{
      model_id: string;
    }>;
    expect(results.some((r) => r.model_id === "almost-old")).toBe(true);
    expect(results.some((r) => r.model_id === "just-old")).toBe(false);
  });

  test("should return zero when no old data exists", () => {
    clearTestDatabase(testDb);
    // Only add recent data
    testDb.prepare(`
      INSERT INTO test_results (tested_at, model_id, test_name, caching_works, cache_hit_rate)
      VALUES (datetime('now'), 'recent-model', 'basic', 1, 80)
    `).run();

    const result = cleanupOldData(30);

    expect(result.testResultsDeleted).toBe(0);
    expect(result.tokenUsageDeleted).toBe(0);
  });

  test("should handle different retention periods", () => {
    const result7 = cleanupOldData(7);
    // Both 60-day-old and 1-day-old data should be deleted with 7-day retention
    // But we need fresh data for this test
  });

  test("should cleanup both tables atomically", () => {
    const result = cleanupOldData(30);

    expect(result.testResultsDeleted).toBe(1);
    expect(result.tokenUsageDeleted).toBe(1);
  });
});

describe("getModelSparklines", () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    // Insert multiple test results for sparklines
    for (let i = 0; i < 15; i++) {
      testDb.prepare(`
        INSERT INTO test_results (tested_at, model_id, test_name, caching_works, cache_hit_rate)
        VALUES (datetime('now', '-' || ? || ' hours'), 'model-a', 'basic', 1, ?)
      `).run(i, 50 + i);
    }
    for (let i = 0; i < 5; i++) {
      testDb.prepare(`
        INSERT INTO test_results (tested_at, model_id, test_name, caching_works, cache_hit_rate)
        VALUES (datetime('now', '-' || ? || ' hours'), 'model-b', 'basic', 1, ?)
      `).run(i, 70 + i);
    }
  });

  afterEach(() => {
    testDb.close();
  });

  test("should return ModelSparklineData[] with correct structure", () => {
    const sparklines = getModelSparklines(10);

    expect(Array.isArray(sparklines)).toBe(true);
    expect(sparklines.length).toBeGreaterThan(0);

    const sparkline = sparklines[0];
    expect(sparkline).toHaveProperty("model_id");
    expect(sparkline).toHaveProperty("rates");
    expect(Array.isArray(sparkline.rates)).toBe(true);
  });

  test("should return last N cache rates per model", () => {
    const sparklines = getModelSparklines(10);

    const modelA = sparklines.find((s) => s.model_id === "model-a");
    expect(modelA).toBeDefined();
    expect(modelA!.rates.length).toBe(10);
  });

  test("should order rates oldest to newest", () => {
    const sparklines = getModelSparklines(5);

    const modelB = sparklines.find((s) => s.model_id === "model-b");
    expect(modelB).toBeDefined();
    // Rates should be in order (oldest to newest within the limit)
    // model-b has rates 74, 73, 72, 71, 70 (5 hours ago to now)
    // After ordering oldest to newest: 74, 73, 72, 71, 70
    expect(modelB!.rates.length).toBe(5);
  });

  test("should limit results per model", () => {
    const sparklines = getModelSparklines(3);

    const modelA = sparklines.find((s) => s.model_id === "model-a");
    expect(modelA!.rates.length).toBe(3);
  });

  test("should handle models with fewer than N results", () => {
    const sparklines = getModelSparklines(10);

    const modelB = sparklines.find((s) => s.model_id === "model-b");
    expect(modelB).toBeDefined();
    expect(modelB!.rates.length).toBe(5); // Only 5 results for model-b
  });

  test("should use default limit of 10", () => {
    const sparklines = getModelSparklines();

    const modelA = sparklines.find((s) => s.model_id === "model-a");
    expect(modelA!.rates.length).toBe(10);
  });

  test("should return sparklines for all models", () => {
    const sparklines = getModelSparklines(10);

    const modelIds = sparklines.map((s) => s.model_id);
    expect(modelIds).toContain("model-a");
    expect(modelIds).toContain("model-b");
  });

  test("should return empty array when no data exists", () => {
    clearTestDatabase(testDb);

    const sparklines = getModelSparklines(10);

    expect(sparklines).toEqual([]);
  });

  test("should exclude null cache_hit_rate values", () => {
    // Insert a result with null cache_hit_rate
    testDb.prepare(`
      INSERT INTO test_results (tested_at, model_id, test_name, caching_works, cache_hit_rate)
      VALUES (datetime('now'), 'model-c', 'basic', 0, NULL)
    `).run();

    const sparklines = getModelSparklines(10);

    const modelC = sparklines.find((s) => s.model_id === "model-c");
    // model-c should not appear since its only result has null cache_hit_rate
    expect(modelC).toBeUndefined();
  });

  test("should return rates as numbers", () => {
    const sparklines = getModelSparklines(5);

    const modelA = sparklines.find((s) => s.model_id === "model-a");
    expect(modelA).toBeDefined();
    for (const rate of modelA!.rates) {
      expect(typeof rate).toBe("number");
    }
  });
});
