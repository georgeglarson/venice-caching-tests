/**
 * Tests for Venice API client functions
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { extractUsage, fetchModels, fetchDiemBalance, sendRequest } from "../../../src/core/api.ts";
import {
  createMockResponse,
  createMockFetch,
  createMockModel,
  createMockModelsResponse,
  createMockChatCompletionResponse,
  createTrackingFetch,
} from "../../helpers/mocks.ts";
import { mockGlobalFetch, restoreGlobalFetch } from "../../setup.ts";
import { SAMPLE_MODELS, RATE_LIMIT_RESPONSE, HTML_ERROR_PAGE } from "../../helpers/fixtures.ts";

describe("extractUsage", () => {
  test("should extract usage from standard response format", () => {
    const usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      cached_tokens: 30,
    };

    const result = extractUsage(usage);

    expect(result).toEqual({
      promptTokens: 100,
      cachedTokens: 30,
      completionTokens: 50,
    });
  });

  test("should handle prompt_tokens_details.cached_tokens format", () => {
    const usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      prompt_tokens_details: {
        cached_tokens: 80,
      },
    };

    const result = extractUsage(usage);

    expect(result).toEqual({
      promptTokens: 100,
      cachedTokens: 80,
      completionTokens: 50,
    });
  });

  test("should handle direct cached_tokens format (fallback)", () => {
    const usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      cached_tokens: 60,
    };

    const result = extractUsage(usage);

    expect(result.cachedTokens).toBe(60);
  });

  test("should prioritize prompt_tokens_details over direct cached_tokens", () => {
    const usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      cached_tokens: 30,
      prompt_tokens_details: {
        cached_tokens: 80,
      },
    };

    const result = extractUsage(usage);

    expect(result.cachedTokens).toBe(80);
  });

  test("should return zeros for missing fields", () => {
    const usage = {};

    const result = extractUsage(usage);

    expect(result).toEqual({
      promptTokens: 0,
      cachedTokens: 0,
      completionTokens: 0,
    });
  });

  test("should handle undefined/null usage object", () => {
    expect(extractUsage(undefined)).toEqual({
      promptTokens: 0,
      cachedTokens: 0,
      completionTokens: 0,
    });

    expect(extractUsage(null)).toEqual({
      promptTokens: 0,
      cachedTokens: 0,
      completionTokens: 0,
    });
  });
});

describe("fetchModels", () => {
  afterEach(() => {
    restoreGlobalFetch();
  });

  test("should fetch models successfully and return array", async () => {
    const mockResponse = createMockResponse({
      status: 200,
      body: createMockModelsResponse(SAMPLE_MODELS),
      headers: { "x-venice-balance-diem": "100.5" },
    });
    mockGlobalFetch(createMockFetch([{ response: mockResponse }]));

    const models = await fetchModels();

    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBe(4);
    expect(models[0].id).toBe("llama-3.3-70b");
  });

  test("should include Authorization header with API key", async () => {
    let capturedHeaders: Record<string, string> = {};

    mockGlobalFetch(async (_url, init) => {
      if (init?.headers) {
        const headers = init.headers as Record<string, string>;
        capturedHeaders = { ...headers };
      }
      return createMockResponse({
        status: 200,
        body: createMockModelsResponse([]),
      });
    });

    await fetchModels();

    expect(capturedHeaders.Authorization).toMatch(/^Bearer /);
  });

  test("should retry on HTTP 429 (rate limit)", async () => {
    let callCount = 0;

    mockGlobalFetch(async () => {
      callCount++;
      if (callCount < 2) {
        return createMockResponse({
          status: 429,
          body: RATE_LIMIT_RESPONSE,
        });
      }
      return createMockResponse({
        status: 200,
        body: createMockModelsResponse([createMockModel()]),
      });
    });

    const models = await fetchModels();

    expect(callCount).toBe(2);
    expect(models.length).toBe(1);
  });

  test("should retry on timeout errors", async () => {
    let callCount = 0;

    mockGlobalFetch(async () => {
      callCount++;
      if (callCount < 2) {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        throw error;
      }
      return createMockResponse({
        status: 200,
        body: createMockModelsResponse([createMockModel()]),
      });
    });

    const models = await fetchModels();

    expect(callCount).toBe(2);
    expect(models.length).toBe(1);
  });

  test("should throw error after max retries exhausted", async () => {
    mockGlobalFetch(async () => {
      return createMockResponse({
        status: 429,
        body: RATE_LIMIT_RESPONSE,
      });
    });

    await expect(fetchModels()).rejects.toThrow(/429/);
  });

  test("should return empty array when data field is missing", async () => {
    mockGlobalFetch(async () =>
      createMockResponse({
        status: 200,
        body: { models: [] }, // Wrong field name
      })
    );

    const models = await fetchModels();

    expect(models).toEqual([]);
  });
});

describe("fetchDiemBalance", () => {
  afterEach(() => {
    restoreGlobalFetch();
  });

  test("should extract balance from x-venice-balance-diem header", async () => {
    mockGlobalFetch(async () =>
      createMockResponse({
        status: 200,
        body: createMockModelsResponse([]),
        headers: { "x-venice-balance-diem": "99.75" },
      })
    );

    const balance = await fetchDiemBalance();

    expect(balance).toBe(99.75);
  });

  test("should return null when header is missing", async () => {
    mockGlobalFetch(async () =>
      createMockResponse({
        status: 200,
        body: createMockModelsResponse([]),
        headers: {},
      })
    );

    const balance = await fetchDiemBalance();

    expect(balance).toBe(null);
  });

  test("should return null when header value is invalid (NaN)", async () => {
    mockGlobalFetch(async () =>
      createMockResponse({
        status: 200,
        body: createMockModelsResponse([]),
        headers: { "x-venice-balance-diem": "invalid" },
      })
    );

    const balance = await fetchDiemBalance();

    expect(balance).toBe(null);
  });

  test("should return null on fetch error", async () => {
    mockGlobalFetch(async () => {
      throw new Error("Network error");
    });

    const balance = await fetchDiemBalance();

    expect(balance).toBe(null);
  });

  test("should handle non-OK responses gracefully", async () => {
    mockGlobalFetch(async () =>
      createMockResponse({
        status: 500,
        ok: false,
        body: { error: "Internal server error" },
      })
    );

    const balance = await fetchDiemBalance();

    expect(balance).toBe(null);
  });
});

describe("sendRequest", () => {
  afterEach(() => {
    restoreGlobalFetch();
  });

  test("should send request with correct payload structure", async () => {
    let capturedBody: unknown;

    mockGlobalFetch(async (_url, init) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse({
          prompt_tokens: 100,
          cached_tokens: 50,
          completion_tokens: 25,
        }),
        headers: { "x-venice-balance-diem": "99.0" },
      });
    });

    await sendRequest("test-model", "You are helpful", "Hello", 50);

    expect(capturedBody).toMatchObject({
      model: "test-model",
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "system", content: expect.stringContaining("You are helpful") }),
        expect.objectContaining({ role: "user", content: "Hello" }),
      ]),
      max_tokens: 50,
      venice_parameters: { include_venice_system_prompt: false },
    });
  });

  test("should inject test run ID into system prompt when provided", async () => {
    let capturedBody: unknown;

    mockGlobalFetch(async (_url, init) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse(),
      });
    });

    await sendRequest(
      "test-model",
      "You are helpful",
      "Hello",
      50,
      "system",
      "test-run-uuid-123"
    );

    const body = capturedBody as { messages: Array<{ role: string; content: string }> };
    const systemMessage = body.messages.find((m) => m.role === "system");

    expect(systemMessage?.content).toContain("test-run-uuid-123");
    expect(systemMessage?.content).toContain("<!-- Test Run:");
  });

  test("should apply cache_control to system message by default", async () => {
    let capturedBody: unknown;

    mockGlobalFetch(async (_url, init) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse(),
      });
    });

    await sendRequest("test-model", "You are helpful", "Hello");

    const body = capturedBody as { messages: Array<{ role: string; cache_control?: { type: string } }> };
    const systemMessage = body.messages.find((m) => m.role === "system");
    const userMessage = body.messages.find((m) => m.role === "user");

    expect(systemMessage?.cache_control).toEqual({ type: "ephemeral" });
    expect(userMessage?.cache_control).toBeUndefined();
  });

  test("should apply cache_control based on cacheControlPlacement parameter", async () => {
    let capturedBodies: unknown[] = [];

    mockGlobalFetch(async (_url, init) => {
      if (init?.body) {
        capturedBodies.push(JSON.parse(init.body as string));
      }
      return createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse(),
      });
    });

    // Test 'user' placement
    await sendRequest("test-model", "System", "User", 50, "user");
    // Test 'both' placement
    await sendRequest("test-model", "System", "User", 50, "both");

    const userPlacement = capturedBodies[0] as { messages: Array<{ role: string; cache_control?: { type: string } }> };
    const bothPlacement = capturedBodies[1] as { messages: Array<{ role: string; cache_control?: { type: string } }> };

    // User placement
    expect(userPlacement.messages.find((m) => m.role === "system")?.cache_control).toBeUndefined();
    expect(userPlacement.messages.find((m) => m.role === "user")?.cache_control).toEqual({ type: "ephemeral" });

    // Both placement
    expect(bothPlacement.messages.find((m) => m.role === "system")?.cache_control).toEqual({ type: "ephemeral" });
    expect(bothPlacement.messages.find((m) => m.role === "user")?.cache_control).toEqual({ type: "ephemeral" });
  });

  test("should use custom timeout from TestConfig.requestTimeoutMs", async () => {
    let callCount = 0;
    const customTimeout = 100; // 100ms

    mockGlobalFetch(async (_url, init) => {
      callCount++;
      // Check that the signal is set up for abort
      const signal = init?.signal as AbortSignal | undefined;

      // Simulate slow response by waiting, but check for abort
      await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(resolve, 200);
        if (signal) {
          signal.addEventListener("abort", () => {
            clearTimeout(timeoutId);
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        }
      });

      return createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse(),
      });
    });

    const result = await sendRequest(
      "test-model",
      "System",
      "User",
      50,
      "system",
      undefined,
      { requestTimeoutMs: customTimeout } as any
    );

    // Should have timed out and returned an error result
    expect(result.error).toBeDefined();
    expect(result.errorType).toBe("timeout");
  });

  test("should retry on HTTP 429 and 5xx errors", async () => {
    let callCount = 0;

    mockGlobalFetch(async () => {
      callCount++;
      if (callCount === 1) {
        return createMockResponse({ status: 429 });
      }
      if (callCount === 2) {
        return createMockResponse({ status: 503 });
      }
      return createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse(),
      });
    });

    const result = await sendRequest("test-model", "System", "User");

    expect(callCount).toBe(3);
    expect(result.error).toBeUndefined();
  });

  test("should not retry on 4xx errors (except 429)", async () => {
    let callCount = 0;

    mockGlobalFetch(async () => {
      callCount++;
      return createMockResponse({
        status: 400,
        ok: false,
        body: { error: "Bad request" },
      });
    });

    const result = await sendRequest("test-model", "System", "User");

    expect(callCount).toBe(1);
    expect(result.error).toBeDefined();
    expect(result.errorType).toBe("api_error");
  });

  test("should extract usage info from response", async () => {
    mockGlobalFetch(async () =>
      createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse({
          prompt_tokens: 150,
          prompt_tokens_details: { cached_tokens: 100 },
          completion_tokens: 30,
        }),
      })
    );

    const result = await sendRequest("test-model", "System", "User");

    expect(result.usage.promptTokens).toBe(150);
    expect(result.usage.cachedTokens).toBe(100);
    expect(result.usage.completionTokens).toBe(30);
  });

  test("should extract diem balance from response headers", async () => {
    mockGlobalFetch(async () =>
      createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse(),
        headers: { "x-venice-balance-diem": "98.5" },
      })
    );

    const result = await sendRequest("test-model", "System", "User");

    expect(result.usage.diemBalance).toBe(98.5);
  });

  test("should categorize errors correctly: rate_limit, timeout, api_error", async () => {
    // Test rate limit error
    mockGlobalFetch(async () => createMockResponse({ status: 429 }));
    let result = await sendRequest("test-model", "System", "User");
    expect(result.errorType).toBe("rate_limit");

    // Test timeout error
    restoreGlobalFetch();
    mockGlobalFetch(async () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    });
    result = await sendRequest("test-model", "System", "User");
    expect(result.errorType).toBe("timeout");

    // Test API error
    restoreGlobalFetch();
    mockGlobalFetch(async () =>
      createMockResponse({
        status: 400,
        ok: false,
        body: { error: "Bad request" },
      })
    );
    result = await sendRequest("test-model", "System", "User");
    expect(result.errorType).toBe("api_error");
  });

  test("should return error result with zero usage on failure", async () => {
    mockGlobalFetch(async () =>
      createMockResponse({
        status: 400,
        ok: false,
      })
    );

    const result = await sendRequest("test-model", "System", "User");

    expect(result.error).toBeDefined();
    expect(result.usage).toEqual({
      promptTokens: 0,
      cachedTokens: 0,
      completionTokens: 0,
    });
  });

  test("should include payload in result for dashboard preview", async () => {
    mockGlobalFetch(async () =>
      createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse(),
      })
    );

    const result = await sendRequest("test-model", "System prompt", "User message", 100);

    expect(result.payload).toBeDefined();
    expect(result.payload.model).toBe("test-model");
    expect(result.payload.max_tokens).toBe(100);
    expect(result.payload.messages.length).toBe(2);
  });
});
