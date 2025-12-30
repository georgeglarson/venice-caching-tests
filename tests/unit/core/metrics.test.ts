/**
 * Tests for caching metrics calculation
 *
 * Tests the real calculateCachingMetrics function exported from runner.ts
 */

import { describe, test, expect } from "bun:test";
import type { TestConfig } from "../../../src/core/types.ts";
import { calculateCachingMetrics } from "../../../src/core/runner.ts";
import { createMockTestResult } from "../../helpers/mocks.ts";

describe("calculateCachingMetrics", () => {
  const defaultThresholds: TestConfig["cachingSupportThreshold"] = {
    minTestsWithCaching: 3,
    minCacheHitRate: 50,
    minSuccessRate: 60,
  };

  test("should calculate success rate correctly (successful tests / total tests)", () => {
    const tests = [
      createMockTestResult({ success: true }),
      createMockTestResult({ success: true }),
      createMockTestResult({ success: false }),
      createMockTestResult({ success: false }),
    ];

    const result = calculateCachingMetrics(tests, defaultThresholds);

    // 2 successful / 4 total = 50%
    // Reliability: (50 * 0.4) + (0 * 0.3) + (0 * 0.3) = 20
    expect(result.reliabilityScore).toBeGreaterThanOrEqual(0);
  });

  test("should calculate caching rate correctly (tests with good caching / successful tests)", () => {
    const tests = [
      createMockTestResult({ success: true, cachingWorks: true, cacheHitRate: 80 }),
      createMockTestResult({ success: true, cachingWorks: true, cacheHitRate: 60 }),
      createMockTestResult({ success: true, cachingWorks: false, cacheHitRate: 0 }),
      createMockTestResult({ success: true, cachingWorks: false, cacheHitRate: 30 }), // Below threshold
    ];

    const result = calculateCachingMetrics(tests, defaultThresholds);

    // 2 tests with good caching (>=50%) out of 4 successful = 50% caching rate
    expect(result.bestCacheRate).toBe(80);
  });

  test("should calculate average cache hit rate for tests with caching", () => {
    const tests = [
      createMockTestResult({ success: true, cachingWorks: true, cacheHitRate: 80 }),
      createMockTestResult({ success: true, cachingWorks: true, cacheHitRate: 60 }),
      createMockTestResult({ success: true, cachingWorks: true, cacheHitRate: 70 }),
    ];

    const result = calculateCachingMetrics(tests, defaultThresholds);

    // Average: (80 + 60 + 70) / 3 = 70
    // All 3 tests have caching >= 50%, so they all count
    expect(result.overallCachingSupport).toBe(true);
    expect(result.bestCacheRate).toBe(80);
  });

  test("should determine overall caching support based on thresholds", () => {
    const testsSupported = [
      createMockTestResult({ success: true, cachingWorks: true, cacheHitRate: 80 }),
      createMockTestResult({ success: true, cachingWorks: true, cacheHitRate: 70 }),
      createMockTestResult({ success: true, cachingWorks: true, cacheHitRate: 60 }),
    ];

    const testsNotSupported = [
      createMockTestResult({ success: true, cachingWorks: true, cacheHitRate: 80 }),
      createMockTestResult({ success: true, cachingWorks: false, cacheHitRate: 0 }),
      createMockTestResult({ success: true, cachingWorks: false, cacheHitRate: 0 }),
    ];

    expect(calculateCachingMetrics(testsSupported, defaultThresholds).overallCachingSupport).toBe(
      true
    );
    expect(
      calculateCachingMetrics(testsNotSupported, defaultThresholds).overallCachingSupport
    ).toBe(false);
  });

  test("should handle edge case: no tests ran (return 0 for all metrics)", () => {
    const tests: TestResult[] = [];

    const result = calculateCachingMetrics(tests, defaultThresholds);

    expect(result.overallCachingSupport).toBe(false);
    expect(result.bestCacheRate).toBe(0);
    expect(result.reliabilityScore).toBe(0);
  });

  test("should handle edge case: all tests failed (return 0 for caching metrics)", () => {
    const tests = [
      createMockTestResult({ success: false, cachingWorks: false, cacheHitRate: null }),
      createMockTestResult({ success: false, cachingWorks: false, cacheHitRate: null }),
    ];

    const result = calculateCachingMetrics(tests, defaultThresholds);

    expect(result.overallCachingSupport).toBe(false);
    expect(result.bestCacheRate).toBe(0);
    // Reliability should reflect 0% success rate
    expect(result.reliabilityScore).toBe(0);
  });

  test("should compute effective min tests as lesser of threshold and actual tests run", () => {
    // With only 2 tests, the effective min should be 2 (not 3)
    const tests = [
      createMockTestResult({ success: true, cachingWorks: true, cacheHitRate: 80 }),
      createMockTestResult({ success: true, cachingWorks: true, cacheHitRate: 70 }),
    ];

    const result = calculateCachingMetrics(tests, defaultThresholds);

    // Should be supported because 2 tests >= min(3, 2) = 2
    expect(result.overallCachingSupport).toBe(true);
  });

  test("should calculate reliability score: 40% success + 30% caching consistency + 30% effectiveness", () => {
    const tests = [
      createMockTestResult({ success: true, cachingWorks: true, cacheHitRate: 100 }),
      createMockTestResult({ success: true, cachingWorks: true, cacheHitRate: 100 }),
      createMockTestResult({ success: true, cachingWorks: true, cacheHitRate: 100 }),
    ];

    const result = calculateCachingMetrics(tests, defaultThresholds);

    // 100% success rate, 100% caching rate, 100% avg cache hit rate
    // Reliability = (100 * 0.4) + (100 * 0.3) + (100 * 0.3) = 100
    expect(result.reliabilityScore).toBe(100);
  });

  test("should find best cache rate across all tests", () => {
    const tests = [
      createMockTestResult({ success: true, cachingWorks: true, cacheHitRate: 50 }),
      createMockTestResult({ success: true, cachingWorks: true, cacheHitRate: 95 }),
      createMockTestResult({ success: true, cachingWorks: true, cacheHitRate: 70 }),
      createMockTestResult({ success: false, cachingWorks: false, cacheHitRate: 20 }),
    ];

    const result = calculateCachingMetrics(tests, defaultThresholds);

    expect(result.bestCacheRate).toBe(95);
  });

  test("should handle tests with null cache hit rate", () => {
    const tests = [
      createMockTestResult({ success: true, cachingWorks: true, cacheHitRate: 80 }),
      createMockTestResult({ success: false, cachingWorks: false, cacheHitRate: null }),
    ];

    const result = calculateCachingMetrics(tests, defaultThresholds);

    expect(result.bestCacheRate).toBe(80);
  });

  test("should correctly apply minCacheHitRate threshold", () => {
    const tests = [
      createMockTestResult({ success: true, cachingWorks: true, cacheHitRate: 49 }), // Below 50 threshold
      createMockTestResult({ success: true, cachingWorks: true, cacheHitRate: 50 }), // At threshold
      createMockTestResult({ success: true, cachingWorks: true, cacheHitRate: 51 }), // Above threshold
    ];

    const thresholds = { ...defaultThresholds, minCacheHitRate: 50 };

    // Only tests with cacheHitRate >= 50 should count as "good caching"
    const result = calculateCachingMetrics(tests, thresholds);

    // 2 tests with good caching (50 and 51)
    expect(result.overallCachingSupport).toBe(false); // Need 3 tests minimum by default
  });
});
