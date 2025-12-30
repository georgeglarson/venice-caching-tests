/**
 * Venice API client functions
 */

import { VENICE_API_URL, getApiKey } from "./config.ts";
import { fetchWithTimeout, parseJsonResponse } from "../utils/http.ts";
import { withRetry, isTimeoutError } from "../utils/retry.ts";
import { env } from "../config/env.ts";
import { API_CONSTANTS } from "../config/constants.ts";
import { metricsCollector } from "../metrics/collector.ts";
import { logWithContext } from "./logger.ts";
import type { UsageInfo, VeniceModel, TestConfig } from "./types.ts";

/**
 * Generates a short unique request ID for correlation tracking.
 * Format: 8-character alphanumeric string
 */
function generateRequestId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Logs API request details if debug logging is enabled.
 */
function logApiRequest(requestId: string, method: string, url: string, payload?: unknown, correlationId?: string): void {
  if (!env.debugApiRequests) return;

  logWithContext("info", `API ${method} ${url}`, { requestId, correlationId }, payload ? { payload } : undefined);
}

/**
 * Logs API response details if debug logging is enabled.
 */
function logApiResponse(requestId: string, status: number, usage?: UsageInfo, error?: string, correlationId?: string): void {
  if (!env.debugApiRequests) return;

  if (error) {
    logWithContext("error", `API Response Error`, { requestId, correlationId }, { status, error });
  } else {
    logWithContext("info", `API Response: ${status}`, { requestId, correlationId }, usage ? { tokens: usage.promptTokens, cached: usage.cachedTokens } : undefined);
  }
}

export function extractUsage(usage: unknown): UsageInfo {
  const u = usage as Record<string, unknown> | undefined;
  const details = u?.prompt_tokens_details as Record<string, unknown> | undefined;
  return {
    promptTokens: (u?.prompt_tokens as number) ?? 0,
    cachedTokens: (details?.cached_tokens as number) ?? (u?.cached_tokens as number) ?? 0,
    completionTokens: (u?.completion_tokens as number) ?? 0,
  };
}

export async function fetchModels(): Promise<VeniceModel[]> {
  const requestId = generateRequestId();
  const url = `${VENICE_API_URL}/models`;
  logApiRequest(requestId, "GET", url);

  const startTime = Date.now();

  try {
    return await withRetry(
      async () => {
        const response = await fetchWithTimeout(url, {
          headers: { Authorization: `Bearer ${getApiKey()}` },
        });

        const duration = Date.now() - startTime;

        if (response.status === 429) {
          metricsCollector.recordApiResponseTime("models", duration, 429);
          metricsCollector.recordError("rate_limit");
          throw new Error(`[${requestId}] Rate limited (HTTP 429)`);
        }

        if (!response.ok) {
          metricsCollector.recordApiResponseTime("models", duration, response.status);
          metricsCollector.recordError("api_error");
          throw new Error(`[${requestId}] Failed to fetch models: ${response.status}`);
        }

        metricsCollector.recordApiResponseTime("models", duration, response.status);

        const data = (await parseJsonResponse(response)) as { data?: VeniceModel[] };
        logApiResponse(requestId, response.status);
        return data.data || [];
      },
      {
        shouldRetry: (error) => {
          // Retry on rate limits, timeouts, and transient errors
          return error.message.includes("429") || isTimeoutError(error);
        },
        onRetry: (error) => {
          // Transform AbortError to more descriptive message
          if (error.name === "AbortError") {
            error.message = `[${requestId}] Request timeout`;
          }
        },
      }
    );
  } catch (e) {
    const duration = Date.now() - startTime;
    metricsCollector.recordApiResponseTime("models", duration, 0);
    if (isTimeoutError(e as Error)) {
      metricsCollector.recordError("timeout");
    } else {
      metricsCollector.recordError("api_error");
    }
    throw e;
  }
}

/**
 * Fetches the current diem balance using a lightweight API call.
 * Uses the /models endpoint which returns balance in response headers.
 * @returns Promise resolving to the current diem balance, or null if unavailable
 */
export async function fetchDiemBalance(): Promise<number | null> {
  const requestId = generateRequestId();
  const url = `${VENICE_API_URL}/models`;
  logApiRequest(requestId, "GET", url);

  const startTime = Date.now();

  try {
    const response = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${getApiKey()}` },
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      metricsCollector.recordApiResponseTime("balance", duration, response.status);
      metricsCollector.recordError("api_error");
      logApiResponse(requestId, response.status, undefined, `HTTP ${response.status}`);
      return null;
    }

    metricsCollector.recordApiResponseTime("balance", duration, response.status);

    const diemBalance = parseFloat(response.headers.get("x-venice-balance-diem") || "");
    logApiResponse(requestId, response.status);
    return isNaN(diemBalance) ? null : diemBalance;
  } catch (e) {
    const duration = Date.now() - startTime;
    metricsCollector.recordApiResponseTime("balance", duration, 0);
    const error = e instanceof Error ? e.message : String(e);
    if (isTimeoutError(e as Error)) {
      metricsCollector.recordError("timeout");
    } else {
      metricsCollector.recordError("api_error");
    }
    logApiResponse(requestId, 0, undefined, error);
    return null;
  }
}

export interface RequestPayload {
  model: string;
  messages: Array<{
    role: string;
    content: string;
    cache_control?: { type: string };
  }>;
  max_tokens: number;
  venice_parameters: { include_venice_system_prompt: boolean };
}

export type ErrorType = 'rate_limit' | 'api_error' | 'timeout' | null;

export interface RequestResult {
  usage: UsageInfo;
  payload: RequestPayload;
  error?: string;
  errorType?: ErrorType;
}

/**
 * Sends a chat completion request to the Venice API with cache control headers.
 *
 * Payload structure (matches dashboard preview in src/dashboard/app.js):
 * ```json
 * {
 *   "model": "<modelId>",
 *   "messages": [
 *     { "role": "system", "content": "<systemPrompt>", "cache_control": { "type": "ephemeral" } },
 *     { "role": "user", "content": "<userMessage>" }
 *   ],
 *   "max_tokens": 50,
 *   "venice_parameters": { "include_venice_system_prompt": false }
 * }
 * ```
 *
 * @param modelId - The Venice model ID to use for the request
 * @param systemPrompt - The system prompt content
 * @param userMessage - The user message content
 * @param maxTokens - Max tokens for the response (defaults to 50)
 * @param cacheControlPlacement - Where to apply cache_control: 'system', 'user', or 'both' (defaults to 'system')
 * @param testRunId - Optional unique test run ID to inject into system prompt for cache isolation
 * @param config - Optional TestConfig for request timeout configuration
 * @param correlationId - Optional correlation ID for end-to-end request tracing
 * @returns Promise resolving to usage information and optional error
 */
export async function sendRequest(
  modelId: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens?: number,
  cacheControlPlacement?: 'system' | 'user' | 'both',
  testRunId?: string,
  config?: TestConfig,
  correlationId?: string
): Promise<RequestResult> {
  const requestId = generateRequestId();
  const timeoutMs = config?.requestTimeoutMs ?? API_CONSTANTS.REQUEST_TIMEOUT_MS;
  const url = `${VENICE_API_URL}/chat/completions`;
  const placement = cacheControlPlacement ?? 'system';
  const cacheControl = { type: "ephemeral" };

  // Inject test run ID into system prompt to ensure cache isolation between test runs
  const effectiveSystemPrompt = testRunId
    ? `${systemPrompt}\n\n<!-- Test Run: ${testRunId} -->`
    : systemPrompt;

  const systemMessage: { role: string; content: string; cache_control?: { type: string } } = {
    role: "system",
    content: effectiveSystemPrompt,
  };
  if (placement === 'system' || placement === 'both') {
    systemMessage.cache_control = cacheControl;
  }

  const userMessageObj: { role: string; content: string; cache_control?: { type: string } } = {
    role: "user",
    content: userMessage,
  };
  if (placement === 'user' || placement === 'both') {
    userMessageObj.cache_control = cacheControl;
  }

  const payload: RequestPayload = {
    model: modelId,
    messages: [systemMessage, userMessageObj],
    max_tokens: maxTokens ?? 50,
    venice_parameters: { include_venice_system_prompt: false },
  };

  logApiRequest(requestId, "POST", url, payload, correlationId);

  const startTime = Date.now();

  try {
    const result = await withRetry(
      async () => {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${getApiKey()}`,
          "Content-Type": "application/json",
        };
        if (correlationId) {
          headers["X-Correlation-Id"] = correlationId;
        }

        const response = await fetchWithTimeout(url, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        }, timeoutMs);

        const duration = Date.now() - startTime;

        if (response.status === 429) {
          metricsCollector.recordApiResponseTime("chat_completions", duration, 429);
          const error = new Error(`[${requestId}] HTTP 429`);
          (error as Error & { statusCode?: number }).statusCode = 429;
          throw error;
        }

        if (response.status >= 500 && response.status < 600) {
          metricsCollector.recordApiResponseTime("chat_completions", duration, response.status);
          const error = new Error(`[${requestId}] HTTP ${response.status}`);
          (error as Error & { statusCode?: number }).statusCode = response.status;
          throw error;
        }

        if (!response.ok) {
          metricsCollector.recordApiResponseTime("chat_completions", duration, response.status);
          const error = new Error(`[${requestId}] HTTP ${response.status}`);
          (error as Error & { statusCode?: number; nonRetryable?: boolean }).statusCode = response.status;
          (error as Error & { nonRetryable?: boolean }).nonRetryable = true;
          throw error;
        }

        metricsCollector.recordApiResponseTime("chat_completions", duration, response.status);

        const diemBalance = parseFloat(response.headers.get("x-venice-balance-diem") || "") || undefined;
        const data = (await parseJsonResponse(response)) as { usage?: unknown };
        const usage = extractUsage(data.usage);
        usage.diemBalance = diemBalance;
        logApiResponse(requestId, response.status, usage, undefined, correlationId);
        return { usage, payload };
      },
      {
        shouldRetry: (error) => {
          // Don't retry non-retryable errors (4xx except 429)
          if ((error as Error & { nonRetryable?: boolean }).nonRetryable) {
            return false;
          }
          const statusCode = (error as Error & { statusCode?: number }).statusCode;
          // Retry on rate limits (429), server errors (5xx), and timeout errors
          return statusCode === 429 || (statusCode !== undefined && statusCode >= 500) || isTimeoutError(error);
        },
        onRetry: (error) => {
          // Transform AbortError to more descriptive message
          if (error.name === "AbortError") {
            error.message = `[${requestId}] Request timeout`;
          }
        },
      }
    );
    return result;
  } catch (e) {
    const duration = Date.now() - startTime;
    const error = e instanceof Error ? e : new Error(String(e));
    const statusCode = (error as Error & { statusCode?: number }).statusCode;
    const isAbort = error.name === "AbortError";

    let errorType: ErrorType;
    let errorMessage: string;

    if (statusCode === 429) {
      errorType = 'rate_limit';
      errorMessage = `[${requestId}] HTTP 429 (after retries)`;
      metricsCollector.recordError("rate_limit", modelId);
    } else if (isTimeoutError(error)) {
      errorType = 'timeout';
      errorMessage = isAbort ? `[${requestId}] Request timeout` : `[${requestId}] ${error.message}`;
      metricsCollector.recordError("timeout", modelId);
    } else {
      errorType = 'api_error';
      errorMessage = `[${requestId}] ${error.message}`;
      metricsCollector.recordError("api_error", modelId);
    }

    // Record response time for failed requests (if not already recorded in retry loop)
    if (statusCode === undefined) {
      metricsCollector.recordApiResponseTime("chat_completions", duration, 0);
    }

    logApiResponse(requestId, 0, undefined, errorMessage, correlationId);

    return {
      usage: { promptTokens: 0, cachedTokens: 0, completionTokens: 0 },
      payload,
      error: errorMessage,
      errorType,
    };
  }
}
