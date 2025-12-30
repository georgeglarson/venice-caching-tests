/**
 * Tests for HTTP utility functions
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { fetchWithTimeout, parseJsonResponse, delay } from "../../../src/utils/http.ts";
import { createMockResponse, createMockFetch, createTimeoutFetch } from "../../helpers/mocks.ts";
import { mockGlobalFetch, restoreGlobalFetch } from "../../setup.ts";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    restoreGlobalFetch();
  });

  test("should successfully fetch when response is within timeout", async () => {
    const mockResponse = createMockResponse({
      status: 200,
      body: { success: true },
    });
    mockGlobalFetch(createMockFetch([{ response: mockResponse }]));

    const response = await fetchWithTimeout("/api/test", { method: "GET" }, 5000);

    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data).toEqual({ success: true });
  });

  test("should abort request when timeout is exceeded", async () => {
    // Create a fetch that never resolves (simulates slow response)
    mockGlobalFetch(async (_, init) => {
      return new Promise((_, reject) => {
        // Simulate the abort behavior
        if (init?.signal) {
          init.signal.addEventListener("abort", () => {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        }
        // Never resolve naturally - wait for abort
      });
    });

    await expect(
      fetchWithTimeout("/api/slow", { method: "GET" }, 50)
    ).rejects.toThrow();
  });

  test("should pass through fetch options correctly", async () => {
    let capturedOptions: RequestInit | undefined;
    mockGlobalFetch(async (_, init) => {
      capturedOptions = init;
      return createMockResponse({ status: 200 });
    });

    await fetchWithTimeout(
      "/api/test",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: "test" }),
      },
      5000
    );

    expect(capturedOptions?.method).toBe("POST");
    expect(capturedOptions?.body).toBe(JSON.stringify({ data: "test" }));
    expect(capturedOptions?.signal).toBeDefined();
  });

  test("should clear timeout after successful response", async () => {
    const clearTimeoutSpy = spyOn(globalThis, "clearTimeout");

    mockGlobalFetch(async () => createMockResponse({ status: 200 }));

    await fetchWithTimeout("/api/test", { method: "GET" }, 5000);

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

describe("parseJsonResponse", () => {
  test("should parse valid JSON response successfully", async () => {
    const response = createMockResponse({
      status: 200,
      body: { key: "value", nested: { data: 123 } },
      contentType: "application/json",
    });

    const data = await parseJsonResponse(response);

    expect(data).toEqual({ key: "value", nested: { data: 123 } });
  });

  test("should throw error when Content-Type is not application/json", async () => {
    const response = createMockResponse({
      status: 503,
      body: "<html><body>Error</body></html>",
      contentType: "text/html",
    });

    await expect(parseJsonResponse(response)).rejects.toThrow(
      /API returned HTML error page/
    );
  });

  test("should include status code in error message for HTML responses", async () => {
    const response = createMockResponse({
      status: 503,
      body: "<html><body>Service Unavailable</body></html>",
      contentType: "text/html",
    });

    await expect(parseJsonResponse(response)).rejects.toThrow(/status 503/);
  });

  test("should include preview of content in error message", async () => {
    const response = createMockResponse({
      status: 500,
      body: "<html><head><title>Error</title></head><body>Internal Server Error</body></html>",
      contentType: "text/html",
    });

    await expect(parseJsonResponse(response)).rejects.toThrow(/Error/);
  });

  test("should handle empty Content-Type header", async () => {
    // Create response with no Content-Type
    const response = {
      status: 200,
      ok: true,
      headers: new Headers({}),
      json: async () => ({ data: "test" }),
      text: async () => '{"data": "test"}',
    } as Response;

    // Should throw because Content-Type is missing
    await expect(parseJsonResponse(response)).rejects.toThrow();
  });

  test("should handle responses with charset in Content-Type", async () => {
    const response = {
      status: 200,
      ok: true,
      headers: new Headers({
        "Content-Type": "application/json; charset=utf-8",
      }),
      json: async () => ({ message: "Hello" }),
      text: async () => '{"message": "Hello"}',
    } as Response;

    const data = await parseJsonResponse(response);

    expect(data).toEqual({ message: "Hello" });
  });
});

describe("delay", () => {
  test("should resolve after specified milliseconds", async () => {
    const start = Date.now();
    await delay(100);
    const elapsed = Date.now() - start;

    // Allow some tolerance for timing
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(200);
  });

  test("should resolve immediately for 0ms delay", async () => {
    const start = Date.now();
    await delay(0);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
  });

  test("should return a Promise that resolves to undefined", async () => {
    const result = await delay(10);
    expect(result).toBeUndefined();
  });
});
