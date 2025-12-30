/**
 * Tests for retry utility functions
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";
import {
  calculateBackoffDelay,
  isTimeoutError,
  withRetry,
} from "../../../src/utils/retry.ts";

describe("calculateBackoffDelay", () => {
  test("should return initialDelayMs for attempt 0", () => {
    expect(calculateBackoffDelay(0, 1000)).toBe(1000);
    expect(calculateBackoffDelay(0, 500)).toBe(500);
    expect(calculateBackoffDelay(0, 2000)).toBe(2000);
  });

  test("should double delay for each subsequent attempt (exponential backoff)", () => {
    const initialDelay = 1000;

    // Attempt 0: 1000 * 2^0 = 1000
    expect(calculateBackoffDelay(0, initialDelay)).toBe(1000);

    // Attempt 1: 1000 * 2^1 = 2000
    expect(calculateBackoffDelay(1, initialDelay)).toBe(2000);

    // Attempt 2: 1000 * 2^2 = 4000
    expect(calculateBackoffDelay(2, initialDelay)).toBe(4000);

    // Attempt 3: 1000 * 2^3 = 8000
    expect(calculateBackoffDelay(3, initialDelay)).toBe(8000);
  });

  test("should calculate correct delays for various initial values", () => {
    // With 500ms initial delay
    expect(calculateBackoffDelay(0, 500)).toBe(500);
    expect(calculateBackoffDelay(1, 500)).toBe(1000);
    expect(calculateBackoffDelay(2, 500)).toBe(2000);

    // With 100ms initial delay
    expect(calculateBackoffDelay(0, 100)).toBe(100);
    expect(calculateBackoffDelay(1, 100)).toBe(200);
    expect(calculateBackoffDelay(2, 100)).toBe(400);
  });
});

describe("isTimeoutError", () => {
  test("should return true for AbortError", () => {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";

    expect(isTimeoutError(error)).toBe(true);
  });

  test('should return true for errors with "timeout" in message (case-insensitive)', () => {
    expect(isTimeoutError(new Error("Request timeout"))).toBe(true);
    expect(isTimeoutError(new Error("TIMEOUT occurred"))).toBe(true);
    expect(isTimeoutError(new Error("Connection Timeout"))).toBe(true);
    expect(isTimeoutError(new Error("The request timed out"))).toBe(false); // doesn't contain "timeout"
  });

  test('should return true for "etimedout" errors', () => {
    expect(isTimeoutError(new Error("ETIMEDOUT"))).toBe(true);
    expect(isTimeoutError(new Error("connect etimedout"))).toBe(true);
  });

  test('should return true for "econnaborted" errors', () => {
    expect(isTimeoutError(new Error("ECONNABORTED"))).toBe(true);
    expect(isTimeoutError(new Error("Connection econnaborted"))).toBe(true);
  });

  test("should return false for other error types", () => {
    expect(isTimeoutError(new Error("Network error"))).toBe(false);
    expect(isTimeoutError(new Error("Connection refused"))).toBe(false);
    expect(isTimeoutError(new Error("HTTP 500"))).toBe(false);
    expect(isTimeoutError(new Error("Invalid JSON"))).toBe(false);
  });
});

describe("withRetry", () => {
  test("should return result on first successful attempt", async () => {
    const operation = mock(async () => "success");

    const result = await withRetry(operation, { maxRetries: 3 });

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  test("should retry on failure up to maxRetries times", async () => {
    let attempts = 0;
    const operation = mock(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("Temporary failure");
      }
      return "success";
    });

    const result = await withRetry(operation, {
      maxRetries: 3,
      initialDelayMs: 10, // Short delay for faster tests
    });

    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });

  test("should apply exponential backoff between retries", async () => {
    const delays: number[] = [];
    let attempt = 0;

    const operation = mock(async () => {
      attempt++;
      if (attempt < 3) {
        throw new Error("Retry needed");
      }
      return "success";
    });

    await withRetry(operation, {
      maxRetries: 3,
      initialDelayMs: 100,
      onRetry: (_, __, delayMs) => {
        delays.push(delayMs);
      },
    });

    expect(delays).toEqual([100, 200]); // First retry: 100ms, Second retry: 200ms
  });

  test("should call onRetry callback with correct parameters", async () => {
    const onRetryMock = mock((error: Error, attempt: number, delayMs: number) => {});
    let attemptCount = 0;

    const operation = mock(async () => {
      attemptCount++;
      if (attemptCount < 2) {
        throw new Error("Test error");
      }
      return "success";
    });

    await withRetry(operation, {
      maxRetries: 3,
      initialDelayMs: 10,
      onRetry: onRetryMock,
    });

    expect(onRetryMock).toHaveBeenCalledTimes(1);
    expect(onRetryMock.mock.calls[0][0].message).toBe("Test error");
    expect(onRetryMock.mock.calls[0][1]).toBe(0); // First attempt (0-indexed)
    expect(onRetryMock.mock.calls[0][2]).toBe(10); // Initial delay
  });

  test("should respect shouldRetry predicate (skip retry when returns false)", async () => {
    const operation = mock(async () => {
      throw new Error("Non-retryable error");
    });

    const shouldRetry = mock((error: Error) => {
      return !error.message.includes("Non-retryable");
    });

    await expect(
      withRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 10,
        shouldRetry,
      })
    ).rejects.toThrow("Non-retryable error");

    expect(operation).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledTimes(1);
  });

  test("should throw last error after all retries exhausted", async () => {
    let attemptCount = 0;
    const operation = mock(async () => {
      attemptCount++;
      throw new Error(`Failure on attempt ${attemptCount}`);
    });

    await expect(
      withRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 10,
      })
    ).rejects.toThrow("Failure on attempt 3");

    expect(operation).toHaveBeenCalledTimes(3);
  });

  test("should not retry when shouldRetry returns false on first attempt", async () => {
    const operation = mock(async () => {
      throw new Error("Immediate failure");
    });

    await expect(
      withRetry(operation, {
        maxRetries: 5,
        initialDelayMs: 10,
        shouldRetry: () => false,
      })
    ).rejects.toThrow("Immediate failure");

    expect(operation).toHaveBeenCalledTimes(1);
  });

  test("should pass attempt number (0-indexed) to operation function", async () => {
    const receivedAttempts: number[] = [];

    const operation = mock(async (attempt: number) => {
      receivedAttempts.push(attempt);
      if (attempt < 2) {
        throw new Error("Retry");
      }
      return "success";
    });

    await withRetry(operation, {
      maxRetries: 3,
      initialDelayMs: 10,
    });

    expect(receivedAttempts).toEqual([0, 1, 2]);
  });

  test("should use default values from API_CONSTANTS when options not provided", async () => {
    const operation = mock(async () => "success");

    const result = await withRetry(operation);

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  test("should handle non-Error throws by wrapping them", async () => {
    let attempt = 0;
    const operation = mock(async () => {
      attempt++;
      if (attempt === 1) {
        throw "string error"; // Non-Error throw
      }
      return "success";
    });

    const result = await withRetry(operation, {
      maxRetries: 2,
      initialDelayMs: 10,
    });

    expect(result).toBe("success");
    expect(attempt).toBe(2);
  });
});
