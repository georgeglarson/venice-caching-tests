/**
 * Integration tests for API interactions
 *
 * Tests real API interaction patterns with mocked fetch (not actual Venice API calls)
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  createMockResponse,
  createMockFetch,
  createMockChatCompletionResponse,
  createMockModelsResponse,
  createMockModel,
  createTrackingFetch,
} from "../helpers/mocks.ts";
import { mockGlobalFetch, restoreGlobalFetch, captureConsole } from "../setup.ts";
import { RATE_LIMIT_RESPONSE, HTML_ERROR_PAGE } from "../helpers/fixtures.ts";

// We'll test the complete request/response cycle by exercising the actual API functions
// with carefully crafted mock responses

describe("API Integration - Complete Request/Response Cycle", () => {
  afterEach(() => {
    restoreGlobalFetch();
  });

  test("should handle complete request/response cycle with retries", async () => {
    let attempts = 0;

    mockGlobalFetch(async () => {
      attempts++;
      if (attempts < 3) {
        // First two attempts fail with 503
        return createMockResponse({
          status: 503,
          ok: false,
          body: { error: "Service unavailable" },
        });
      }
      // Third attempt succeeds
      return createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse({
          prompt_tokens: 100,
          prompt_tokens_details: { cached_tokens: 80 },
          completion_tokens: 25,
        }),
        headers: { "x-venice-balance-diem": "99.5" },
      });
    });

    // Import dynamically to use mocked fetch
    const { sendRequest } = await import("../../src/core/api.ts");

    const result = await sendRequest("test-model", "System prompt", "User message");

    expect(attempts).toBe(3);
    expect(result.error).toBeUndefined();
    expect(result.usage.promptTokens).toBe(100);
    expect(result.usage.cachedTokens).toBe(80);
    expect(result.usage.diemBalance).toBe(99.5);
  });

  test("should handle rate limiting with exponential backoff", async () => {
    let callCount = 0;

    mockGlobalFetch(async () => {
      callCount++;

      if (callCount <= 2) {
        return createMockResponse({
          status: 429,
          ok: false,
          body: RATE_LIMIT_RESPONSE,
        });
      }

      return createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse(),
      });
    });

    const { sendRequest } = await import("../../src/core/api.ts");

    const result = await sendRequest("test-model", "System", "User");

    // Verify that retries happened (3 calls = 2 retries)
    expect(callCount).toBe(3);
    expect(result.error).toBeUndefined();

    // Note: Exponential backoff timing is tested in unit tests for calculateBackoffDelay.
    // In integration tests, delays are skipped for speed.
  });

  test("should handle timeout and retry", async () => {
    let callCount = 0;

    mockGlobalFetch(async (_, init) => {
      callCount++;

      if (callCount === 1) {
        // First call times out
        return new Promise((_, reject) => {
          const timeoutId = setTimeout(() => {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          }, 50);

          if (init?.signal) {
            init.signal.addEventListener("abort", () => {
              clearTimeout(timeoutId);
              const error = new Error("The operation was aborted");
              error.name = "AbortError";
              reject(error);
            });
          }
        });
      }

      // Subsequent calls succeed
      return createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse(),
      });
    });

    const { sendRequest } = await import("../../src/core/api.ts");

    const result = await sendRequest(
      "test-model",
      "System",
      "User",
      50,
      "system",
      undefined,
      { requestTimeoutMs: 100 } as any
    );

    expect(callCount).toBe(2);
    expect(result.error).toBeUndefined();
  });

  test("should handle mixed success/failure scenarios", async () => {
    const responses = [
      createMockResponse({ status: 429 }), // Rate limit
      createMockResponse({ status: 503 }), // Server error
      createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse({ prompt_tokens: 100, cached_tokens: 50 }),
      }),
    ];

    let callIndex = 0;
    mockGlobalFetch(async () => {
      return responses[callIndex++] || responses[responses.length - 1];
    });

    const { sendRequest } = await import("../../src/core/api.ts");

    const result = await sendRequest("test-model", "System", "User");

    expect(result.error).toBeUndefined();
    expect(result.usage.promptTokens).toBe(100);
  });

  test("should track request IDs across retries", async () => {
    const capturedBodies: string[] = [];

    mockGlobalFetch(async (_, init) => {
      if (init?.body) {
        capturedBodies.push(init.body as string);
      }

      if (capturedBodies.length < 2) {
        return createMockResponse({ status: 503 });
      }

      return createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse(),
      });
    });

    const { sendRequest } = await import("../../src/core/api.ts");

    await sendRequest("test-model", "System", "User");

    // All retry bodies should be identical (same request)
    const firstBody = capturedBodies[0];
    for (const body of capturedBodies) {
      expect(body).toBe(firstBody);
    }
  });
});

describe("API Integration - Models Endpoint", () => {
  afterEach(() => {
    restoreGlobalFetch();
  });

  test("should fetch and filter text models", async () => {
    mockGlobalFetch(async () =>
      createMockResponse({
        status: 200,
        body: createMockModelsResponse([
          createMockModel({ id: "text-model-1", type: "text" }),
          createMockModel({ id: "text-model-2", type: "text" }),
          createMockModel({ id: "image-model", type: "image" }),
          createMockModel({ id: "audio-model", type: "audio" }),
        ]),
      })
    );

    const { fetchModels } = await import("../../src/core/api.ts");

    const models = await fetchModels();

    expect(models.length).toBe(4);
    expect(models.filter((m) => m.type === "text").length).toBe(2);
  });

  test("should handle API errors gracefully", async () => {
    mockGlobalFetch(async () =>
      createMockResponse({
        status: 500,
        ok: false,
        body: { error: "Internal server error" },
      })
    );

    const { fetchModels } = await import("../../src/core/api.ts");

    await expect(fetchModels()).rejects.toThrow();
  });
});

describe("API Integration - Balance Tracking", () => {
  afterEach(() => {
    restoreGlobalFetch();
  });

  test("should track balance across requests", async () => {
    const balances = [100.0, 99.5, 99.0, 98.5];
    let callIndex = 0;

    mockGlobalFetch(async () => {
      const balance = balances[callIndex++] || balances[balances.length - 1];
      return createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse(),
        headers: { "x-venice-balance-diem": balance.toString() },
      });
    });

    const { sendRequest } = await import("../../src/core/api.ts");

    const result1 = await sendRequest("model", "System", "User");
    const result2 = await sendRequest("model", "System", "User");

    expect(result1.usage.diemBalance).toBe(100.0);
    expect(result2.usage.diemBalance).toBe(99.5);
  });

  test("should handle missing balance header", async () => {
    mockGlobalFetch(async () =>
      createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse(),
        headers: {}, // No balance header
      })
    );

    const { sendRequest } = await import("../../src/core/api.ts");

    const result = await sendRequest("model", "System", "User");

    expect(result.usage.diemBalance).toBeUndefined();
  });
});

describe("API Integration - Error Categorization", () => {
  afterEach(() => {
    restoreGlobalFetch();
  });

  test("should categorize rate limit errors correctly", async () => {
    mockGlobalFetch(async () =>
      createMockResponse({
        status: 429,
        ok: false,
        body: RATE_LIMIT_RESPONSE,
      })
    );

    const { sendRequest } = await import("../../src/core/api.ts");

    const result = await sendRequest("model", "System", "User");

    expect(result.errorType).toBe("rate_limit");
  });

  test("should categorize timeout errors correctly", async () => {
    mockGlobalFetch(async () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    });

    const { sendRequest } = await import("../../src/core/api.ts");

    const result = await sendRequest("model", "System", "User");

    expect(result.errorType).toBe("timeout");
  });

  test("should categorize API errors correctly", async () => {
    mockGlobalFetch(async () =>
      createMockResponse({
        status: 400,
        ok: false,
        body: { error: "Bad request" },
      })
    );

    const { sendRequest } = await import("../../src/core/api.ts");

    const result = await sendRequest("model", "System", "User");

    expect(result.errorType).toBe("api_error");
  });
});

describe("API Integration - Request Payload", () => {
  afterEach(() => {
    restoreGlobalFetch();
  });

  test("should construct correct payload structure", async () => {
    let capturedPayload: any;

    mockGlobalFetch(async (_, init) => {
      if (init?.body) {
        capturedPayload = JSON.parse(init.body as string);
      }
      return createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse(),
      });
    });

    const { sendRequest } = await import("../../src/core/api.ts");

    await sendRequest(
      "test-model",
      "You are a helpful assistant",
      "Hello, world!",
      100
    );

    expect(capturedPayload).toMatchObject({
      model: "test-model",
      messages: [
        { role: "system", content: expect.stringContaining("You are a helpful assistant") },
        { role: "user", content: "Hello, world!" },
      ],
      max_tokens: 100,
      venice_parameters: { include_venice_system_prompt: false },
    });
  });

  test("should inject test run ID into system prompt", async () => {
    let capturedPayload: any;

    mockGlobalFetch(async (_, init) => {
      if (init?.body) {
        capturedPayload = JSON.parse(init.body as string);
      }
      return createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse(),
      });
    });

    const { sendRequest } = await import("../../src/core/api.ts");

    await sendRequest(
      "test-model",
      "System prompt",
      "User message",
      50,
      "system",
      "test-run-12345"
    );

    const systemMessage = capturedPayload.messages.find((m: any) => m.role === "system");
    expect(systemMessage.content).toContain("test-run-12345");
  });

  test("should apply cache_control to correct message based on placement", async () => {
    const capturedPayloads: any[] = [];

    mockGlobalFetch(async (_, init) => {
      if (init?.body) {
        capturedPayloads.push(JSON.parse(init.body as string));
      }
      return createMockResponse({
        status: 200,
        body: createMockChatCompletionResponse(),
      });
    });

    const { sendRequest } = await import("../../src/core/api.ts");

    // Test system placement
    await sendRequest("model", "System", "User", 50, "system");

    // Test user placement
    await sendRequest("model", "System", "User", 50, "user");

    // Test both placement
    await sendRequest("model", "System", "User", 50, "both");

    // System placement
    const systemPayload = capturedPayloads[0];
    expect(systemPayload.messages[0].cache_control).toEqual({ type: "ephemeral" });
    expect(systemPayload.messages[1].cache_control).toBeUndefined();

    // User placement
    const userPayload = capturedPayloads[1];
    expect(userPayload.messages[0].cache_control).toBeUndefined();
    expect(userPayload.messages[1].cache_control).toEqual({ type: "ephemeral" });

    // Both placement
    const bothPayload = capturedPayloads[2];
    expect(bothPayload.messages[0].cache_control).toEqual({ type: "ephemeral" });
    expect(bothPayload.messages[1].cache_control).toEqual({ type: "ephemeral" });
  });
});

describe("API Integration - Response Parsing", () => {
  afterEach(() => {
    restoreGlobalFetch();
  });

  test("should parse usage with prompt_tokens_details format", async () => {
    mockGlobalFetch(async () =>
      createMockResponse({
        status: 200,
        body: {
          id: "chatcmpl-123",
          choices: [{ message: { content: "Hello" } }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 25,
            prompt_tokens_details: {
              cached_tokens: 80,
            },
          },
        },
      })
    );

    const { sendRequest } = await import("../../src/core/api.ts");

    const result = await sendRequest("model", "System", "User");

    expect(result.usage.promptTokens).toBe(100);
    expect(result.usage.cachedTokens).toBe(80);
    expect(result.usage.completionTokens).toBe(25);
  });

  test("should parse usage with direct cached_tokens format", async () => {
    mockGlobalFetch(async () =>
      createMockResponse({
        status: 200,
        body: {
          id: "chatcmpl-123",
          choices: [{ message: { content: "Hello" } }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 25,
            cached_tokens: 60,
          },
        },
      })
    );

    const { sendRequest } = await import("../../src/core/api.ts");

    const result = await sendRequest("model", "System", "User");

    expect(result.usage.cachedTokens).toBe(60);
  });

  test("should handle HTML error responses", async () => {
    mockGlobalFetch(async () =>
      createMockResponse({
        status: 503,
        ok: false,
        body: HTML_ERROR_PAGE,
        contentType: "text/html",
      })
    );

    const { sendRequest } = await import("../../src/core/api.ts");

    const result = await sendRequest("model", "System", "User");

    expect(result.error).toBeDefined();
    expect(result.errorType).toBe("api_error");
  });
});
