/**
 * Basic caching test - The fundamental test
 * Sends identical request twice and measures cached tokens
 */

import { sendRequest } from "../api.ts";
import { PROMPTS } from "../config.ts";
import type { TestConfig, TestResult } from "../types.ts";

export async function testBasicCaching(modelId: string, config: TestConfig): Promise<TestResult> {
  const testRunId = config.injectTestRunId !== false ? config.testRunId : undefined;
  const correlationId = config.correlationId;

  const result: TestResult = {
    testName: "basic",
    model: modelId,
    success: false,
    cachingWorks: false,
    cacheHitRate: null,
    details: {},
    testRunId,
  };

  const req1 = await sendRequest(modelId, PROMPTS.large, "Say hello.", config.maxTokens, config.cacheControlPlacement, testRunId, config, correlationId);
  if (req1.error) {
    result.error = req1.error;
    result.details.firstRequest = req1;
    return result;
  }
  result.details.firstRequest = req1;

  // Check for potential cache pollution from previous runs
  if (req1.usage.cachedTokens > 0) {
    result.cacheIsolationNote = "Warning: First request shows cached tokens - possible cache pollution from previous runs";
  }

  await Bun.sleep(config.delayBetweenRequests ?? 500);

  const req2 = await sendRequest(modelId, PROMPTS.large, "Say hello.", config.maxTokens, config.cacheControlPlacement, testRunId, config, correlationId);
  if (req2.error) {
    result.error = req2.error;
    result.details.secondRequest = req2;
    return result;
  }
  result.details.secondRequest = req2;

  result.success = true;
  result.cachingWorks = req2.usage.cachedTokens > 0;
  result.cacheHitRate =
    req2.usage.promptTokens > 0
      ? (req2.usage.cachedTokens / req2.usage.promptTokens) * 100
      : 0;

  if (testRunId && !result.cacheIsolationNote) {
    result.cacheIsolationNote = "Cache isolation enabled via unique test run ID";
  }

  return result;
}
