/**
 * Retry utility functions with exponential backoff
 * Provides reusable retry logic for handling transient failures.
 */

import { API_CONSTANTS } from "../config/constants.ts";
import { delay as httpDelay } from "./http.ts";

/**
 * Delay function type for dependency injection in tests
 */
type DelayFn = (ms: number) => Promise<void>;

/**
 * The delay function used by retry logic.
 * Can be replaced for testing via setDelayFunction.
 */
let delayFn: DelayFn = httpDelay;

/**
 * Sets a custom delay function for testing purposes.
 * Call with no arguments to restore the default delay.
 * @param fn - Custom delay function, or undefined to restore default
 */
export function setDelayFunction(fn?: DelayFn): void {
  delayFn = fn ?? httpDelay;
}

/**
 * Options for configuring retry behavior.
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: API_CONSTANTS.MAX_RETRIES) */
  maxRetries?: number;
  /** Initial delay in milliseconds before first retry (default: API_CONSTANTS.INITIAL_RETRY_DELAY_MS) */
  initialDelayMs?: number;
  /** Custom predicate to determine if an error should trigger a retry */
  shouldRetry?: (error: Error, attempt: number) => boolean;
  /** Callback invoked before each retry attempt, useful for logging */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
}

/**
 * Calculates exponential backoff delay for a given attempt.
 * Pure function for computing delay based on attempt number.
 *
 * @param attempt - The current attempt number (0-indexed)
 * @param initialDelayMs - The base delay in milliseconds
 * @returns The calculated delay in milliseconds
 * @example
 * calculateBackoffDelay(0, 1000); // 1000
 * calculateBackoffDelay(1, 1000); // 2000
 * calculateBackoffDelay(2, 1000); // 4000
 */
export function calculateBackoffDelay(
  attempt: number,
  initialDelayMs: number
): number {
  return initialDelayMs * Math.pow(2, attempt);
}

/**
 * Detects if an error is a timeout-related error.
 * Checks for AbortError, and common timeout error messages.
 *
 * @param error - The error to check
 * @returns True if the error is timeout-related
 */
export function isTimeoutError(error: Error): boolean {
  if (error.name === "AbortError") {
    return true;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("etimedout") ||
    message.includes("econnaborted")
  );
}

/**
 * Wraps an async operation with retry logic and exponential backoff.
 * Automatically retries on failures with configurable behavior.
 *
 * @param operation - Async function to retry, receives attempt number (0-indexed)
 * @param options - Retry configuration options
 * @returns Promise resolving to operation result
 * @throws Last error encountered after all retries exhausted
 * @example
 * const result = await withRetry(
 *   async (attempt) => {
 *     console.log(`Attempt ${attempt + 1}`);
 *     return fetch('/api/data');
 *   },
 *   { maxRetries: 3, initialDelayMs: 1000 }
 * );
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = API_CONSTANTS.MAX_RETRIES,
    initialDelayMs = API_CONSTANTS.INITIAL_RETRY_DELAY_MS,
    shouldRetry,
    onRetry,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation(attempt);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));

      // Check if we should retry
      const canRetry = attempt < maxRetries - 1;
      const willRetry = canRetry && (shouldRetry ? shouldRetry(lastError, attempt) : true);

      if (willRetry) {
        const retryDelay = calculateBackoffDelay(attempt, initialDelayMs);
        if (onRetry) {
          onRetry(lastError, attempt, retryDelay);
        }
        await delayFn(retryDelay);
        continue;
      }

      // No more retries - throw the error
      throw lastError;
    }
  }

  // Should never reach here, but TypeScript needs a return
  throw lastError || new Error("Max retries exceeded");
}
