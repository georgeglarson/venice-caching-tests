/**
 * Tests for test runner orchestration
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { testModel, runTests, formatResultsTable } from "../../../src/core/runner.ts";
import {
  createMockModel,
  createMockTestResult,
  createMockTestConfig,
  createMockResponse,
  createMockModelsResponse,
  createMockChatCompletionResponse,
} from "../../helpers/mocks.ts";
import { mockGlobalFetch, restoreGlobalFetch } from "../../setup.ts";
import { SAMPLE_MODELS } from "../../helpers/fixtures.ts";
import type { TestResult, VeniceModel, TestConfig } from "../../../src/core/types.ts";

describe("testModel", () => {
  afterEach(() => {
    restoreGlobalFetch();
  });

  test("should run enabled tests only (skip disabled tests)", async () => {
    // Mock fetch to return successful responses
    mockGlobalFetch(async () =>
      createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse({
          prompt_tokens: 100,
          prompt_tokens_details: { cached_tokens: 80 },
          completion_tokens: 25,
        }),
      })
    );

    const model = createMockModel({ id: "test-model" });
    const config = createMockTestConfig({
      runBasicTest: true,
      runPromptSizeTest: false,
      runPartialCacheTest: false,
      runPersistenceTest: false,
      runTTLTest: false,
      delayBetweenRequests: 10,
    });

    const result = await testModel(model, { config });

    // Only basic test should run
    expect(result.tests.length).toBe(1);
    expect(result.tests[0].testName).toBe("basic");
  });

  test("should generate unique test run ID when injectTestRunId is true", async () => {
    mockGlobalFetch(async () =>
      createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse(),
      })
    );

    const model = createMockModel();
    const config = createMockTestConfig({
      runBasicTest: true,
      runPromptSizeTest: false,
      runPartialCacheTest: false,
      runPersistenceTest: false,
      runTTLTest: false,
      injectTestRunId: true,
      delayBetweenRequests: 10,
    });

    const result = await testModel(model, { config });

    // The test should have run (even if it shows no caching)
    expect(result.tests.length).toBe(1);
  });

  test("should call onTestComplete callback for each test (started, completed, failed)", async () => {
    mockGlobalFetch(async () =>
      createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse(),
      })
    );

    const onTestComplete = mock(
      (testName: string, status: "started" | "completed" | "failed", result?: TestResult) => {}
    );

    const model = createMockModel();
    const config = createMockTestConfig({
      runBasicTest: true,
      runPromptSizeTest: false,
      runPartialCacheTest: false,
      runPersistenceTest: false,
      runTTLTest: false,
      delayBetweenRequests: 10,
    });

    await testModel(model, { config, onTestComplete });

    // Should be called twice: once for "started", once for "completed"
    expect(onTestComplete).toHaveBeenCalledTimes(2);
    expect(onTestComplete.mock.calls[0][0]).toBe("basic");
    expect(onTestComplete.mock.calls[0][1]).toBe("started");
    expect(onTestComplete.mock.calls[1][0]).toBe("basic");
    expect(onTestComplete.mock.calls[1][1]).toBe("completed");
  });

  test("should handle test function errors gracefully (add error to results)", async () => {
    // Mock fetch to throw an error
    mockGlobalFetch(async () => {
      throw new Error("Network failure");
    });

    const model = createMockModel();
    const config = createMockTestConfig({
      runBasicTest: true,
      runPromptSizeTest: false,
      runPartialCacheTest: false,
      runPersistenceTest: false,
      runTTLTest: false,
      delayBetweenRequests: 10,
    });

    const result = await testModel(model, { config });

    expect(result.tests.length).toBe(1);
    expect(result.tests[0].success).toBe(false);
    expect(result.tests[0].error).toBeDefined();
  });

  test("should calculate overall metrics after all tests complete", async () => {
    mockGlobalFetch(async () =>
      createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse({
          prompt_tokens: 100,
          prompt_tokens_details: { cached_tokens: 80 },
          completion_tokens: 25,
        }),
      })
    );

    const model = createMockModel();
    const config = createMockTestConfig({
      runBasicTest: true,
      runPromptSizeTest: false,
      runPartialCacheTest: false,
      runPersistenceTest: false,
      runTTLTest: false,
      delayBetweenRequests: 10,
    });

    const result = await testModel(model, { config });

    // Should have calculated metrics
    expect(typeof result.overallCachingSupport).toBe("boolean");
    expect(typeof result.bestCacheRate).toBe("number");
    expect(typeof result.cachingReliabilityScore).toBe("number");
  });
});

describe("runTests", () => {
  afterEach(() => {
    restoreGlobalFetch();
  });

  test("should fetch all text models from API", async () => {
    let modelsFetched = false;

    mockGlobalFetch(async (url) => {
      if (url.toString().includes("/models")) {
        modelsFetched = true;
        return createMockResponse({
          status: 200,
          body: createMockModelsResponse(SAMPLE_MODELS),
        });
      }
      return createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse(),
      });
    });

    const config = createMockTestConfig({
      runBasicTest: true,
      runPromptSizeTest: false,
      runPartialCacheTest: false,
      runPersistenceTest: false,
      runTTLTest: false,
      maxModels: 1,
      delayBetweenModels: 10,
      delayBetweenRequests: 10,
    });

    await runTests({ config });

    expect(modelsFetched).toBe(true);
  });

  test("should filter models by config.selectedModels when provided", async () => {
    mockGlobalFetch(async (url) => {
      if (url.toString().includes("/models")) {
        return createMockResponse({
          status: 200,
          body: createMockModelsResponse(SAMPLE_MODELS),
        });
      }
      return createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse(),
      });
    });

    const config = createMockTestConfig({
      runBasicTest: true,
      runPromptSizeTest: false,
      runPartialCacheTest: false,
      runPersistenceTest: false,
      runTTLTest: false,
      selectedModels: ["llama-3.3-70b"],
      delayBetweenModels: 10,
      delayBetweenRequests: 10,
    });

    const results = await runTests({ config });

    expect(results.length).toBe(1);
    expect(results[0].model).toBe("llama-3.3-70b");
  });

  test("should limit models by config.maxModels when set", async () => {
    mockGlobalFetch(async (url) => {
      if (url.toString().includes("/models")) {
        return createMockResponse({
          status: 200,
          body: createMockModelsResponse(SAMPLE_MODELS),
        });
      }
      return createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse(),
      });
    });

    const config = createMockTestConfig({
      runBasicTest: true,
      runPromptSizeTest: false,
      runPartialCacheTest: false,
      runPersistenceTest: false,
      runTTLTest: false,
      maxModels: 2,
      delayBetweenModels: 10,
      delayBetweenRequests: 10,
    });

    const results = await runTests({ config });

    // Only 3 text models in SAMPLE_MODELS (one is image), maxModels limits to 2
    expect(results.length).toBe(2);
  });

  test("should call onProgress callback with correct event data", async () => {
    mockGlobalFetch(async (url) => {
      if (url.toString().includes("/models")) {
        return createMockResponse({
          status: 200,
          body: createMockModelsResponse([createMockModel({ id: "test-model", type: "text" })]),
        });
      }
      return createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse(),
      });
    });

    const onProgress = mock((event: any) => {});

    const config = createMockTestConfig({
      runBasicTest: true,
      runPromptSizeTest: false,
      runPartialCacheTest: false,
      runPersistenceTest: false,
      runTTLTest: false,
      delayBetweenModels: 10,
      delayBetweenRequests: 10,
    });

    await runTests({ config, runId: 123, onProgress });

    expect(onProgress).toHaveBeenCalled();

    const firstCall = onProgress.mock.calls[0][0];
    expect(firstCall.runId).toBe(123);
    expect(firstCall.modelId).toBe("test-model");
    expect(firstCall.testName).toBe("basic");
    expect(firstCall.status).toBe("started");
    expect(firstCall.progress).toBeDefined();
    expect(firstCall.timestamp).toBeDefined();
  });

  test("should return array of ModelResults", async () => {
    mockGlobalFetch(async (url) => {
      if (url.toString().includes("/models")) {
        return createMockResponse({
          status: 200,
          body: createMockModelsResponse([createMockModel({ id: "model-1", type: "text" })]),
        });
      }
      return createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse(),
      });
    });

    const config = createMockTestConfig({
      runBasicTest: true,
      runPromptSizeTest: false,
      runPartialCacheTest: false,
      runPersistenceTest: false,
      runTTLTest: false,
      delayBetweenModels: 10,
      delayBetweenRequests: 10,
    });

    const results = await runTests({ config });

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(1);
    expect(results[0]).toMatchObject({
      model: expect.any(String),
      modelName: expect.any(String),
      tests: expect.any(Array),
      overallCachingSupport: expect.any(Boolean),
      bestCacheRate: expect.any(Number),
      cachingReliabilityScore: expect.any(Number),
    });
  });
});

describe("formatResultsTable", () => {
  test("should format results as table with headers", () => {
    const results = [
      {
        model: "llama-3.3-70b",
        modelName: "Llama 3.3 70B",
        tests: [
          createMockTestResult({ testName: "basic", cachingWorks: true, cacheHitRate: 80 }),
          createMockTestResult({ testName: "prompt_sizes", cachingWorks: true, cacheHitRate: 75 }),
        ],
        overallCachingSupport: true,
        bestCacheRate: 80,
        cachingReliabilityScore: 85,
      },
    ];

    const table = formatResultsTable(results);

    expect(table).toContain("Model");
    expect(table).toContain("Basic");
    expect(table).toContain("Sizes");
    expect(table).toContain("llama-3.3-70b");
    expect(table).toContain("80%");
  });

  test("should show checkmarks for working caching and X for non-working", () => {
    const results = [
      {
        model: "test-model",
        modelName: "Test Model",
        tests: [
          createMockTestResult({ testName: "basic", cachingWorks: true, cacheHitRate: 80 }),
          createMockTestResult({ testName: "prompt_sizes", cachingWorks: false, cacheHitRate: 0 }),
        ],
        overallCachingSupport: false,
        bestCacheRate: 80,
        cachingReliabilityScore: 50,
      },
    ];

    const table = formatResultsTable(results);

    expect(table).toContain("✅");
    expect(table).toContain("❌");
  });

  test("should handle N/A for missing tests", () => {
    const results = [
      {
        model: "test-model",
        modelName: "Test Model",
        tests: [
          createMockTestResult({ testName: "basic", cachingWorks: true, cacheHitRate: 80 }),
        ],
        overallCachingSupport: false,
        bestCacheRate: 80,
        cachingReliabilityScore: 50,
      },
    ];

    const table = formatResultsTable(results);

    expect(table).toContain("N/A");
  });
});
