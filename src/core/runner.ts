/**
 * Test runner orchestration
 */

import { fetchModels, type RequestResult } from "./api.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import {
  testBasicCaching,
  testPromptSizes,
  testPartialCache,
  testPersistence,
  testTTL,
} from "./tests/index.ts";
import { metricsCollector } from "../metrics/collector.ts";
import type {
  ModelResults,
  TestConfig,
  TestProgressCallback,
  TestResult,
  VeniceModel,
} from "./types.ts";

export function calculateCachingMetrics(
  tests: TestResult[],
  thresholds: TestConfig['cachingSupportThreshold']
): { overallCachingSupport: boolean; bestCacheRate: number; reliabilityScore: number } {
  // Filter tests that actually ran (not skipped)
  const ranTests = tests.filter(t => t.success !== undefined);
  const successfulTests = tests.filter(t => t.success);

  // Tests with meaningful caching (above threshold)
  const testsWithGoodCaching = successfulTests.filter(
    t => t.cachingWorks &&
         t.cacheHitRate !== null &&
         t.cacheHitRate >= thresholds.minCacheHitRate
  );

  // Calculate metrics
  const successRate = ranTests.length > 0
    ? (successfulTests.length / ranTests.length) * 100
    : 0;

  const cachingRate = successfulTests.length > 0
    ? (testsWithGoodCaching.length / successfulTests.length) * 100
    : 0;

  const avgCacheHitRate = testsWithGoodCaching.length > 0
    ? testsWithGoodCaching.reduce((sum, t) => sum + (t.cacheHitRate || 0), 0) / testsWithGoodCaching.length
    : 0;

  // Compute effective minTestsWithCaching as the lesser of the configured threshold
  // and the number of tests that actually ran. This ensures overallCachingSupport
  // remains achievable when fewer tests are enabled/run than the default minimum.
  const effectiveMinTests = Math.min(thresholds.minTestsWithCaching, ranTests.length);

  // Determine overall support based on thresholds
  const meetsMinTests = testsWithGoodCaching.length >= effectiveMinTests;
  const meetsSuccessRate = successRate >= thresholds.minSuccessRate;
  const overallCachingSupport = meetsMinTests && meetsSuccessRate;

  // Calculate reliability score (0-100)
  // Weighted: 40% success rate, 30% caching consistency, 30% cache effectiveness
  const reliabilityScore = Math.round(
    (successRate * 0.4) +
    (cachingRate * 0.3) +
    (avgCacheHitRate * 0.3)
  );

  // Best cache rate across all tests
  const bestCacheRate = Math.max(
    ...tests.map(t => t.cacheHitRate ?? 0),
    0
  );

  return { overallCachingSupport, bestCacheRate, reliabilityScore };
}

export interface TestModelOptions {
  config: TestConfig;
  onTestComplete?: (
    testName: string,
    status: "started" | "completed" | "failed",
    result?: TestResult
  ) => void;
  log?: (msg: string) => void;
}

export async function testModel(
  model: VeniceModel,
  options: TestModelOptions
): Promise<ModelResults> {
  const { config, onTestComplete, log = console.log } = options;

  // Generate a unique test run ID for cache isolation if enabled
  const testRunId = config.injectTestRunId !== false ? (config.testRunId ?? crypto.randomUUID()) : undefined;
  // Generate correlation ID for tracking across the test lifecycle
  const correlationId = crypto.randomUUID();
  const testConfig: TestConfig = { ...config, testRunId, correlationId };

  const results: ModelResults = {
    model: model.id,
    modelName: model.model_spec?.name || model.id,
    tests: [],
    overallCachingSupport: false,
    bestCacheRate: 0,
    cachingReliabilityScore: 0,
  };

  const testFunctions: Array<[string, boolean, () => Promise<TestResult>]> = [
    ["basic", config.runBasicTest, () => testBasicCaching(model.id, testConfig)],
    ["prompt_sizes", config.runPromptSizeTest, () => testPromptSizes(model.id, testConfig)],
    ["partial_cache", config.runPartialCacheTest, () => testPartialCache(model.id, testConfig)],
    ["persistence", config.runPersistenceTest, () => testPersistence(model.id, testConfig)],
    ["ttl", config.runTTLTest, () => testTTL(model.id, testConfig, log)],
  ];

  // Track active tests
  metricsCollector.incrementActiveTests();

  try {
    for (const [name, enabled, fn] of testFunctions) {
      if (!enabled) continue;

      onTestComplete?.(name, "started");
      const testStartTime = Date.now();

      try {
        const result = await fn();
        const testDuration = Date.now() - testStartTime;

        // Record test duration and result
        metricsCollector.recordTestDuration(name, testDuration);
        metricsCollector.recordTestResult(name, result.success ?? false);

        results.tests.push(result);
        onTestComplete?.(name, "completed", result);
      } catch (error) {
        const testDuration = Date.now() - testStartTime;

        // Record test duration and failure
        metricsCollector.recordTestDuration(name, testDuration);
        metricsCollector.recordTestResult(name, false);
        metricsCollector.recordError("test_error", model.id);

        onTestComplete?.(name, "failed");
        results.tests.push({
          testName: name,
          model: model.id,
          success: false,
          cachingWorks: false,
          cacheHitRate: null,
          details: {},
          error: String(error),
        });
      }
    }

    const metrics = calculateCachingMetrics(results.tests, config.cachingSupportThreshold);
    results.overallCachingSupport = metrics.overallCachingSupport;
    results.bestCacheRate = metrics.bestCacheRate;
    results.cachingReliabilityScore = metrics.reliabilityScore;

    return results;
  } finally {
    // Always decrement active tests count
    metricsCollector.decrementActiveTests();
  }
}

export interface RunTestsOptions {
  config?: TestConfig;
  runId?: number;
  onProgress?: TestProgressCallback;
  log?: (msg: string) => void;
}

export async function runTests(options: RunTestsOptions = {}): Promise<ModelResults[]> {
  const { config = DEFAULT_CONFIG, runId, onProgress, log = console.log } = options;

  const allModels = await fetchModels();
  const textModels = allModels.filter((m) => m.type === "text");

  let models = textModels;
  if (config.selectedModels?.length) {
    models = textModels.filter((m) => config.selectedModels!.includes(m.id));
  } else if (config.maxModels > 0) {
    models = textModels.slice(0, config.maxModels);
  }

  const total = models.length;
  const results: ModelResults[] = [];

  for (let i = 0; i < models.length; i++) {
    const model = models[i]!;

    const modelResult = await testModel(model, {
      config,
      log,
      onTestComplete: (testName, status, result) => {
        // Extract detailed request data from result.details
        let requestPayload = undefined;
        let responseUsage = undefined;
        let errorMessage = result?.error;

        if (result?.details) {
          // For basic, partial_cache tests - get secondRequest (the one that shows cache behavior)
          const secondReq = result.details.secondRequest as RequestResult | undefined;
          const firstReq = result.details.firstRequest as RequestResult | undefined;

          if (secondReq) {
            requestPayload = secondReq.payload;
            responseUsage = secondReq.usage;
            if (secondReq.error) errorMessage = secondReq.error;
          } else if (firstReq) {
            requestPayload = firstReq.payload;
            responseUsage = firstReq.usage;
            if (firstReq.error) errorMessage = firstReq.error;
          }

          // For persistence test - get last request from the requests array
          const requests = result.details.requests as Array<RequestResult & { attempt: number }> | undefined;
          if (requests?.length) {
            const lastReq = requests[requests.length - 1];
            requestPayload = lastReq?.payload;
            responseUsage = lastReq?.usage;
            if (lastReq?.error) errorMessage = lastReq.error;
          }

          // For prompt-sizes test - select the largest size entry
          const sizes = result.details.sizes as Record<string, { firstRequest: RequestResult; secondRequest: RequestResult }> | undefined;
          if (sizes && !requestPayload && !responseUsage) {
            // Priority order: xlarge > large > medium > small
            const sizeOrder = ["xlarge", "large", "medium", "small"];
            for (const size of sizeOrder) {
              if (sizes[size]) {
                const sizeEntry = sizes[size];
                const req = sizeEntry.secondRequest || sizeEntry.firstRequest;
                if (req) {
                  requestPayload = req.payload;
                  responseUsage = req.usage;
                  if (req.error) errorMessage = req.error;
                }
                break;
              }
            }
          }

          // For TTL test - select the last delay entry
          const delays = result.details.delays as Record<string, { firstRequest: RequestResult; secondRequest: RequestResult }> | undefined;
          if (delays && !requestPayload && !responseUsage) {
            // Get all delay keys and pick the last one (highest delay)
            const delayKeys = Object.keys(delays);
            if (delayKeys.length > 0) {
              const lastDelayKey = delayKeys[delayKeys.length - 1]!;
              const delayEntry = delays[lastDelayKey];
              if (delayEntry) {
                const req = delayEntry.secondRequest || delayEntry.firstRequest;
                if (req) {
                  requestPayload = req.payload;
                  responseUsage = req.usage;
                  if (req.error) errorMessage = req.error;
                }
              }
            }
          }
        }

        onProgress?.({
          runId,
          modelId: model.id,
          modelName: model.model_spec?.name || model.id,
          testName,
          status,
          result,
          progress: { completed: i, total },
          timestamp: new Date().toISOString(),
          requestPayload,
          responseUsage,
          errorMessage,
        });
      },
    });

    results.push(modelResult);

    if (i < models.length - 1) {
      await Bun.sleep(config.delayBetweenModels);
    }
  }

  return results;
}

export function formatResultsTable(results: ModelResults[]): string {
  const lines: string[] = [];

  lines.push("-".repeat(115));
  lines.push(
    "Model                          | Basic    | Sizes    | Partial  | Persist  | Reliability | Overall"
  );
  lines.push("-".repeat(115));

  const fmt = (t: TestResult | undefined) =>
    t
      ? t.cachingWorks
        ? `${t.cacheHitRate?.toFixed(0)}%`.padStart(5) + " ✅"
        : "  0% ❌"
      : "  N/A  ";

  for (const r of results) {
    const basic = r.tests.find((t) => t.testName === "basic");
    const sizes = r.tests.find((t) => t.testName === "prompt_sizes");
    const partial = r.tests.find((t) => t.testName === "partial_cache");
    const persist = r.tests.find((t) => t.testName === "persistence");
    const reliability = `${r.cachingReliabilityScore}%`.padStart(4);

    lines.push(
      `${r.model.padEnd(30)} | ${fmt(basic)} | ${fmt(sizes)} | ${fmt(partial)} | ${fmt(persist)} |     ${reliability}   | ${r.overallCachingSupport ? "✅ YES" : "❌ NO"}`
    );
  }

  return lines.join("\n");
}

export { fetchModels };
