/**
 * Venice API client functions
 */

import { VENICE_API_URL, getApiKey } from "./config.ts";
import type { UsageInfo, VeniceModel } from "./types.ts";

// Request timeout in milliseconds
const REQUEST_TIMEOUT_MS = 30000;

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 2000; // Start with 2s, then 4s, then 8s

/**
 * Creates a fetch request with timeout using AbortController
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Delays execution for specified milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout(`${VENICE_API_URL}/models`, {
        headers: { Authorization: `Bearer ${getApiKey()}` },
      });

      if (response.status === 429) {
        // Rate limited - wait and retry with exponential backoff
        const retryDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        await delay(retryDelay);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }

      const data = (await response.json()) as { data?: VeniceModel[] };
      return data.data || [];
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));

      // Check if it's a timeout (aborted)
      if (lastError.name === 'AbortError') {
        lastError = new Error('Request timeout');
      }

      // Retry on transient errors
      if (attempt < MAX_RETRIES - 1) {
        const retryDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        await delay(retryDelay);
        continue;
      }
    }
  }

  throw lastError || new Error('Failed to fetch models after retries');
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
 * @returns Promise resolving to usage information and optional error
 */
export async function sendRequest(
  modelId: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens?: number,
  cacheControlPlacement?: 'system' | 'user' | 'both',
  testRunId?: string
): Promise<RequestResult> {
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

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout(`${VENICE_API_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getApiKey()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.status === 429) {
        // Rate limited - retry with exponential backoff
        if (attempt < MAX_RETRIES - 1) {
          const retryDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
          await delay(retryDelay);
          continue;
        }
        return {
          usage: { promptTokens: 0, cachedTokens: 0, completionTokens: 0 },
          payload,
          error: `HTTP 429 (after ${MAX_RETRIES} retries)`,
          errorType: 'rate_limit' as ErrorType,
        };
      }

      if (!response.ok) {
        // Server errors (5xx) are retryable
        if (response.status >= 500 && response.status < 600 && attempt < MAX_RETRIES - 1) {
          const retryDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
          await delay(retryDelay);
          continue;
        }
        return {
          usage: { promptTokens: 0, cachedTokens: 0, completionTokens: 0 },
          payload,
          error: `HTTP ${response.status}`,
          errorType: 'api_error' as ErrorType,
        };
      }

      const diemBalance = parseFloat(response.headers.get("x-venice-balance-diem") || "") || undefined;
      const data = (await response.json()) as { usage?: unknown };
      const usage = extractUsage(data.usage);
      usage.diemBalance = diemBalance;
      return { usage, payload };
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      const isAbort = error.name === 'AbortError';
      const errorMessage = String(e).toLowerCase();
      const isTimeout = isAbort ||
                        errorMessage.includes('timeout') ||
                        errorMessage.includes('etimedout') ||
                        errorMessage.includes('econnaborted');

      // Retry on timeout/network errors
      if (attempt < MAX_RETRIES - 1) {
        const retryDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        await delay(retryDelay);
        continue;
      }

      return {
        usage: { promptTokens: 0, cachedTokens: 0, completionTokens: 0 },
        payload,
        error: isAbort ? 'Request timeout' : String(e),
        errorType: isTimeout ? 'timeout' : 'api_error',
      };
    }
  }

  // Should never reach here, but TypeScript needs a return
  return {
    usage: { promptTokens: 0, cachedTokens: 0, completionTokens: 0 },
    payload,
    error: 'Max retries exceeded',
    errorType: 'api_error',
  };
}
