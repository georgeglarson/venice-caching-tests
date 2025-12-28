/**
 * TTL test - Tests cache lifetime with varying delays
 */

import { sendRequest, type RequestResult, type ErrorType } from "../api.ts";
import { PROMPTS } from "../config.ts";
import type { TestConfig, TestResult } from "../types.ts";

export async function testTTL(
  modelId: string,
  config: TestConfig,
  log: (msg: string) => void = console.log
): Promise<TestResult> {
  const testRunId = config.injectTestRunId !== false ? config.testRunId : undefined;
  const delays = config.ttlDelays ?? [1, 5, 10, 30];
  let attemptedCount = 0;
  let failedCount = 0;
  const errors: Array<{ attempt: string | number; error: string; errorType?: ErrorType }> = [];
  const cacheRates: number[] = [];
  let hasFirstRequestCacheHit = false;

  const result: TestResult = {
    testName: "ttl",
    model: modelId,
    success: false,
    cachingWorks: false,
    cacheHitRate: null,
    details: { delays: {} },
    attemptedCount: 0,
    failedCount: 0,
    errors: [],
    testRunId,
  };

  for (const delay of delays) {
    const req1 = await sendRequest(modelId, PROMPTS.large, "Test.", config.maxTokens, config.cacheControlPlacement, testRunId);
    attemptedCount++;
    if (req1.error) {
      failedCount++;
      errors.push({ attempt: `${delay}s`, error: req1.error, errorType: req1.errorType });
      (result.details.delays as Record<string, { firstRequest: RequestResult; failed: boolean; error: string }>)[`${delay}s`] = {
        firstRequest: req1,
        failed: true,
        error: req1.error,
      };
      continue;
    }

    // Check for potential cache pollution on first request of each delay test
    if (!req1.error && req1.usage.cachedTokens > 0) {
      hasFirstRequestCacheHit = true;
    }

    log(`    Waiting ${delay}s...`);
    await Bun.sleep(delay * 1000);

    const req2 = await sendRequest(modelId, PROMPTS.large, "Test.", config.maxTokens, config.cacheControlPlacement, testRunId);
    attemptedCount++;
    if (req2.error) {
      failedCount++;
      errors.push({ attempt: `${delay}s`, error: req2.error, errorType: req2.errorType });
      (result.details.delays as Record<string, { firstRequest: RequestResult; secondRequest: RequestResult; failed: boolean; error: string }>)[`${delay}s`] = {
        firstRequest: req1,
        secondRequest: req2,
        failed: true,
        error: req2.error,
      };
      continue;
    }

    const rate =
      req2.usage.promptTokens > 0
        ? (req2.usage.cachedTokens / req2.usage.promptTokens) * 100
        : 0;

    (result.details.delays as Record<string, { firstRequest: RequestResult; secondRequest: RequestResult; cached: number; rate: string }>)[`${delay}s`] = {
      firstRequest: req1,
      secondRequest: req2,
      cached: req2.usage.cachedTokens,
      rate: rate.toFixed(1) + "%",
    };

    if (req2.usage.cachedTokens > 0) result.cachingWorks = true;
    cacheRates.push(rate);
  }

  result.attemptedCount = attemptedCount;
  result.failedCount = failedCount;
  result.errors = errors;
  result.success = failedCount === 0;
  result.cacheHitRate =
    cacheRates.length > 0
      ? cacheRates.reduce((a, b) => a + b, 0) / cacheRates.length
      : null;

  if (failedCount > 0) {
    result.error = `${failedCount} of ${attemptedCount} attempts failed`;
  }

  if (hasFirstRequestCacheHit) {
    result.cacheIsolationNote = "Warning: First request shows cached tokens - possible cache pollution from previous runs";
  } else if (testRunId) {
    result.cacheIsolationNote = "Cache isolation enabled via unique test run ID";
  }

  return result;
}
