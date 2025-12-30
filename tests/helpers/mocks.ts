/**
 * Mock factories for test dependencies
 */

import type { UsageInfo, VeniceModel, TestResult, TestConfig } from "../../src/core/types.ts";
import type { RequestPayload, RequestResult, ErrorType } from "../../src/core/api.ts";

/**
 * Creates a mock Response object with configurable properties
 */
export function createMockResponse(options: {
  status?: number;
  ok?: boolean;
  headers?: Record<string, string>;
  body?: unknown;
  contentType?: string;
}): Response {
  const {
    status = 200,
    ok = status >= 200 && status < 300,
    headers = {},
    body = {},
    contentType = "application/json",
  } = options;

  const allHeaders = new Headers({
    "Content-Type": contentType,
    ...headers,
  });

  return {
    status,
    ok,
    headers: allHeaders,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    clone: () => createMockResponse(options),
  } as Response;
}

/**
 * Creates a mock fetch function that returns predefined responses
 */
export function createMockFetch(responses: Array<{
  url?: string | RegExp;
  response: Response | (() => Response);
  delay?: number;
}>): typeof fetch {
  let callIndex = 0;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();

    // Find matching response
    for (const config of responses) {
      if (config.url) {
        if (typeof config.url === "string" && !url.includes(config.url)) continue;
        if (config.url instanceof RegExp && !config.url.test(url)) continue;
      }

      if (config.delay) {
        await new Promise((resolve) => setTimeout(resolve, config.delay));
      }

      return typeof config.response === "function" ? config.response() : config.response;
    }

    // Default: return response based on call order
    const responseConfig = responses[callIndex % responses.length];
    callIndex++;

    if (responseConfig?.delay) {
      await new Promise((resolve) => setTimeout(resolve, responseConfig.delay));
    }

    return typeof responseConfig?.response === "function"
      ? responseConfig.response()
      : responseConfig?.response ?? createMockResponse({ status: 404 });
  };
}

/**
 * Creates a mock fetch that times out
 */
export function createTimeoutFetch(timeoutMs: number): typeof fetch {
  return async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const controller = init?.signal;

    return new Promise((_, reject) => {
      const timeout = setTimeout(() => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        reject(error);
      }, timeoutMs);

      if (controller) {
        controller.addEventListener("abort", () => {
          clearTimeout(timeout);
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        });
      }
    });
  };
}

/**
 * Creates a mock VeniceModel
 */
export function createMockModel(overrides: Partial<VeniceModel> = {}): VeniceModel {
  return {
    id: "test-model",
    type: "text",
    model_spec: {
      name: "Test Model",
    },
    ...overrides,
  };
}

/**
 * Creates a mock UsageInfo
 */
export function createMockUsage(overrides: Partial<UsageInfo> = {}): UsageInfo {
  return {
    promptTokens: 100,
    cachedTokens: 50,
    completionTokens: 25,
    ...overrides,
  };
}

/**
 * Creates a mock TestResult
 */
export function createMockTestResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    testName: "basic",
    model: "test-model",
    success: true,
    cachingWorks: true,
    cacheHitRate: 50,
    details: {},
    ...overrides,
  };
}

/**
 * Creates a mock RequestPayload
 */
export function createMockPayload(overrides: Partial<RequestPayload> = {}): RequestPayload {
  return {
    model: "test-model",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
    ],
    max_tokens: 50,
    venice_parameters: { include_venice_system_prompt: false },
    ...overrides,
  };
}

/**
 * Creates a mock RequestResult
 */
export function createMockRequestResult(overrides: Partial<RequestResult> = {}): RequestResult {
  return {
    usage: createMockUsage(),
    payload: createMockPayload(),
    ...overrides,
  };
}

/**
 * Creates a mock TestConfig with default values
 */
export function createMockTestConfig(overrides: Partial<TestConfig> = {}): TestConfig {
  return {
    runBasicTest: true,
    runPromptSizeTest: true,
    runPartialCacheTest: true,
    runPersistenceTest: true,
    runTTLTest: true,
    maxModels: 0,
    delayBetweenModels: 100, // Faster for tests
    cachingSupportThreshold: {
      minTestsWithCaching: 3,
      minCacheHitRate: 50,
      minSuccessRate: 60,
    },
    maxTokens: 50,
    cacheControlPlacement: "system",
    delayBetweenRequests: 100, // Faster for tests
    ttlDelays: [1, 2],
    injectTestRunId: true,
    isolationDelay: 100,
    persistenceRequests: 3,
    basicTestRepetitions: 1,
    requestTimeoutMs: 5000,
    ...overrides,
  };
}

/**
 * Creates a mock Venice API chat completion response
 */
export function createMockChatCompletionResponse(usage: Partial<{
  prompt_tokens: number;
  cached_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
}> = {}): unknown {
  return {
    id: "chatcmpl-test-123",
    object: "chat.completion",
    created: Date.now(),
    model: "test-model",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "Hello! How can I help you today?",
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: usage.prompt_tokens ?? 100,
      completion_tokens: usage.completion_tokens ?? 25,
      cached_tokens: usage.cached_tokens,
      prompt_tokens_details: usage.prompt_tokens_details,
    },
  };
}

/**
 * Creates a mock Venice API models list response
 */
export function createMockModelsResponse(models: VeniceModel[] = []): { data: VeniceModel[] } {
  return {
    data: models.length > 0 ? models : [
      createMockModel({ id: "llama-3.3-70b", type: "text" }),
      createMockModel({ id: "deepseek-r1", type: "text" }),
      createMockModel({ id: "image-model", type: "image" }),
    ],
  };
}

/**
 * Tracks fetch calls for verification
 */
export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export function createTrackingFetch(
  mockFetch: typeof fetch
): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];

  const trackingFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};

    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(init.headers)) {
        for (const [key, value] of init.headers) {
          headers[key] = value;
        }
      } else {
        Object.assign(headers, init.headers);
      }
    }

    let body: unknown = undefined;
    if (init?.body) {
      try {
        body = JSON.parse(init.body as string);
      } catch {
        body = init.body;
      }
    }

    calls.push({
      url,
      method: init?.method || "GET",
      headers,
      body,
    });

    return mockFetch(input, init);
  };

  return { fetch: trackingFetch, calls };
}
