/**
 * Prompt sizes test - Tests caching across different prompt sizes
 */

import { sendRequest, type RequestResult, type ErrorType } from "../api.ts";
import { PROMPTS, type PromptSize } from "../config.ts";
import type { TestConfig, TestResult } from "../types.ts";

export async function testPromptSizes(modelId: string, config: TestConfig): Promise<TestResult> {
  const testRunId = config.injectTestRunId !== false ? config.testRunId : undefined;
  const correlationId = config.correlationId;
  const sizes: PromptSize[] = ["small", "medium", "large", "xlarge"];
  let attemptedCount = 0;
  let failedCount = 0;
  const errors: Array<{ attempt: string | number; error: string; errorType?: ErrorType }> = [];
  const cacheRates: number[] = [];
  let hasFirstRequestCacheHit = false;

  const result: TestResult = {
    testName: "prompt_sizes",
    model: modelId,
    success: false,
    cachingWorks: false,
    cacheHitRate: null,
    details: { sizes: {} },
    attemptedCount: 0,
    failedCount: 0,
    errors: [],
    testRunId,
  };

  for (const size of sizes) {
    const req1 = await sendRequest(modelId, PROMPTS[size], "Hi.", config.maxTokens, config.cacheControlPlacement, testRunId, config, correlationId);
    attemptedCount++;
    if (req1.error) {
      failedCount++;
      errors.push({ attempt: size, error: req1.error, errorType: req1.errorType });
      (result.details.sizes as Record<string, { firstRequest: RequestResult; failed: boolean; error: string }>)[size] = {
        firstRequest: req1,
        failed: true,
        error: req1.error,
      };
      continue;
    }

    // Check for potential cache pollution from previous runs
    if (req1.usage.cachedTokens > 0) {
      hasFirstRequestCacheHit = true;
    }

    await Bun.sleep(config.delayBetweenRequests ?? 500);

    const req2 = await sendRequest(modelId, PROMPTS[size], "Hi.", config.maxTokens, config.cacheControlPlacement, testRunId, config, correlationId);
    attemptedCount++;
    if (req2.error) {
      failedCount++;
      errors.push({ attempt: size, error: req2.error, errorType: req2.errorType });
      (result.details.sizes as Record<string, { firstRequest: RequestResult; secondRequest: RequestResult; failed: boolean; error: string }>)[size] = {
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

    (result.details.sizes as Record<string, { firstRequest: RequestResult; secondRequest: RequestResult; tokens: number; cached: number; rate: string }>)[size] = {
      firstRequest: req1,
      secondRequest: req2,
      tokens: req2.usage.promptTokens,
      cached: req2.usage.cachedTokens,
      rate: rate.toFixed(1) + "%",
    };

    if (req2.usage.cachedTokens > 0) result.cachingWorks = true;
    cacheRates.push(rate);
  }

  result.attemptedCount = attemptedCount;
  result.failedCount = failedCount;
  result.errors = errors;
  result.success = failedCount === 0 && cacheRates.length === sizes.length;
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
