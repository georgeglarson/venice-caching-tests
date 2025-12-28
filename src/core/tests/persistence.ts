/**
 * Persistence test - Tests cache durability across multiple requests
 */

import { sendRequest, type RequestResult, type ErrorType } from "../api.ts";
import { PROMPTS } from "../config.ts";
import type { TestConfig, TestResult } from "../types.ts";

export async function testPersistence(modelId: string, config: TestConfig): Promise<TestResult> {
  const testRunId = config.injectTestRunId !== false ? config.testRunId : undefined;
  const totalAttempts = config.persistenceRequests ?? 10;
  let attemptedCount = 0;
  let failedCount = 0;
  const errors: Array<{ attempt: string | number; error: string; errorType?: ErrorType }> = [];
  let hasFirstRequestCacheHit = false;

  const result: TestResult = {
    testName: "persistence",
    model: modelId,
    success: false,
    cachingWorks: false,
    cacheHitRate: null,
    details: { requests: [] },
    attemptedCount: 0,
    failedCount: 0,
    errors: [],
    testRunId,
  };

  for (let i = 0; i < totalAttempts; i++) {
    attemptedCount++;
    const req = await sendRequest(modelId, PROMPTS.large, "Count.", config.maxTokens, config.cacheControlPlacement, testRunId);

    if (req.error) {
      failedCount++;
      errors.push({ attempt: i + 1, error: req.error, errorType: req.errorType });
    }

    // Check for potential cache pollution on first request
    if (i === 0 && !req.error && req.usage.cachedTokens > 0) {
      hasFirstRequestCacheHit = true;
    }

    (result.details.requests as Array<RequestResult & { attempt: number; failed?: boolean }>).push({
      attempt: i + 1,
      ...req,
      ...(req.error ? { failed: true } : {}),
    });

    await Bun.sleep(config.delayBetweenRequests ?? 500);
  }

  result.attemptedCount = attemptedCount;
  result.failedCount = failedCount;
  result.errors = errors;
  result.success = failedCount === 0;

  if (failedCount > 0) {
    result.error = `${failedCount} of ${attemptedCount} attempts failed`;
  }

  const requests = result.details.requests as Array<RequestResult & { attempt: number; failed?: boolean }>;
  const last = requests[totalAttempts - 1];

  if (last && !last.error) {
    result.cachingWorks = last.usage.cachedTokens > 0;
    result.cacheHitRate =
      last.usage.promptTokens > 0 ? (last.usage.cachedTokens / last.usage.promptTokens) * 100 : 0;
  } else {
    result.cachingWorks = false;
    result.cacheHitRate = null;
  }

  if (hasFirstRequestCacheHit) {
    result.cacheIsolationNote = "Warning: First request shows cached tokens - possible cache pollution from previous runs";
  } else if (testRunId) {
    result.cacheIsolationNote = "Cache isolation enabled via unique test run ID";
  }

  return result;
}
