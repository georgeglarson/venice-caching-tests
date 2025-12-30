/**
 * Reusable test data fixtures
 */

import type { UsageInfo, VeniceModel, TestResult } from "../../src/core/types.ts";
import type { TestResultRow, TokenUsageRow } from "../../src/db/schema.ts";

// Sample Venice API responses
export const SAMPLE_MODELS: VeniceModel[] = [
  {
    id: "llama-3.3-70b",
    type: "text",
    model_spec: { name: "Llama 3.3 70B" },
  },
  {
    id: "deepseek-r1",
    type: "text",
    model_spec: { name: "DeepSeek R1" },
  },
  {
    id: "qwen-2.5-coder",
    type: "text",
    model_spec: { name: "Qwen 2.5 Coder" },
  },
  {
    id: "flux-pro",
    type: "image",
    model_spec: { name: "Flux Pro" },
  },
];

// Sample usage info objects
export const USAGE_WITH_CACHING: UsageInfo = {
  promptTokens: 1000,
  cachedTokens: 800,
  completionTokens: 50,
};

export const USAGE_WITHOUT_CACHING: UsageInfo = {
  promptTokens: 1000,
  cachedTokens: 0,
  completionTokens: 50,
};

export const USAGE_PARTIAL_CACHING: UsageInfo = {
  promptTokens: 1000,
  cachedTokens: 300,
  completionTokens: 50,
};

export const USAGE_WITH_BALANCE: UsageInfo = {
  promptTokens: 500,
  cachedTokens: 400,
  completionTokens: 25,
  diemBalance: 99.5,
};

// Sample test results with various cache rates
export const SUCCESSFUL_CACHE_RESULT: TestResult = {
  testName: "basic",
  model: "llama-3.3-70b",
  success: true,
  cachingWorks: true,
  cacheHitRate: 80,
  details: {
    firstRequest: {
      usage: { promptTokens: 1000, cachedTokens: 0, completionTokens: 50 },
    },
    secondRequest: {
      usage: { promptTokens: 1000, cachedTokens: 800, completionTokens: 50 },
    },
  },
};

export const FAILED_CACHE_RESULT: TestResult = {
  testName: "basic",
  model: "llama-3.3-70b",
  success: true,
  cachingWorks: false,
  cacheHitRate: 0,
  details: {
    firstRequest: {
      usage: { promptTokens: 1000, cachedTokens: 0, completionTokens: 50 },
    },
    secondRequest: {
      usage: { promptTokens: 1000, cachedTokens: 0, completionTokens: 50 },
    },
  },
};

export const PARTIAL_CACHE_RESULT: TestResult = {
  testName: "partial_cache",
  model: "llama-3.3-70b",
  success: true,
  cachingWorks: true,
  cacheHitRate: 60,
  details: {
    basePrompt: "You are a helpful assistant...",
    modifiedPrompt: "You are a helpful assistant...\nAdditional context.",
    firstRequest: {
      usage: { promptTokens: 1200, cachedTokens: 0, completionTokens: 50 },
    },
    secondRequest: {
      usage: { promptTokens: 1500, cachedTokens: 900, completionTokens: 50 },
    },
  },
};

export const ERROR_RESULT: TestResult = {
  testName: "basic",
  model: "llama-3.3-70b",
  success: false,
  cachingWorks: false,
  cacheHitRate: null,
  details: {},
  error: "API Error: HTTP 500",
};

export const TIMEOUT_ERROR_RESULT: TestResult = {
  testName: "basic",
  model: "llama-3.3-70b",
  success: false,
  cachingWorks: false,
  cacheHitRate: null,
  details: {},
  error: "Request timeout after 30000ms",
};

// Sample database rows
export const SAMPLE_TEST_RESULT_ROWS: TestResultRow[] = [
  {
    id: 1,
    tested_at: "2024-01-15T10:00:00Z",
    model_id: "llama-3.3-70b",
    model_name: "Llama 3.3 70B",
    test_name: "basic",
    caching_works: 1,
    cache_hit_rate: 80,
    details_json: JSON.stringify({ cached: true }),
    error: null,
    test_run_id: "run-123",
    cache_isolation_note: null,
  },
  {
    id: 2,
    tested_at: "2024-01-15T10:05:00Z",
    model_id: "llama-3.3-70b",
    model_name: "Llama 3.3 70B",
    test_name: "persistence",
    caching_works: 1,
    cache_hit_rate: 75,
    details_json: JSON.stringify({ requests: 10 }),
    error: null,
    test_run_id: "run-123",
    cache_isolation_note: null,
  },
  {
    id: 3,
    tested_at: "2024-01-15T10:10:00Z",
    model_id: "deepseek-r1",
    model_name: "DeepSeek R1",
    test_name: "basic",
    caching_works: 0,
    cache_hit_rate: 0,
    details_json: JSON.stringify({}),
    error: null,
    test_run_id: "run-124",
    cache_isolation_note: null,
  },
];

export const SAMPLE_TOKEN_USAGE_ROWS: TokenUsageRow[] = [
  {
    id: 1,
    recorded_at: "2024-01-15T10:00:00Z",
    model_id: "llama-3.3-70b",
    prompt_tokens: 1000,
    cached_tokens: 800,
    completion_tokens: 50,
  },
  {
    id: 2,
    recorded_at: "2024-01-15T10:05:00Z",
    model_id: "llama-3.3-70b",
    prompt_tokens: 1200,
    cached_tokens: 900,
    completion_tokens: 60,
  },
  {
    id: 3,
    recorded_at: "2024-01-15T10:10:00Z",
    model_id: "deepseek-r1",
    prompt_tokens: 500,
    cached_tokens: 0,
    completion_tokens: 30,
  },
];

// Sample API error responses
export const RATE_LIMIT_RESPONSE = {
  error: {
    message: "Rate limit exceeded. Please try again later.",
    type: "rate_limit_error",
    code: "rate_limit_exceeded",
  },
};

export const INTERNAL_SERVER_ERROR_RESPONSE = {
  error: {
    message: "Internal server error",
    type: "internal_error",
    code: "internal_error",
  },
};

export const UNAUTHORIZED_RESPONSE = {
  error: {
    message: "Invalid API key",
    type: "invalid_request_error",
    code: "invalid_api_key",
  },
};

// HTML error page (for testing non-JSON responses)
export const HTML_ERROR_PAGE = `<!DOCTYPE html>
<html>
<head><title>503 Service Unavailable</title></head>
<body>
<h1>Service Temporarily Unavailable</h1>
<p>The server is currently unable to handle the request.</p>
</body>
</html>`;

// Sample prompts for testing
export const TEST_PROMPTS = {
  small: "You are a helpful assistant.",
  medium: "You are an expert software engineer with deep knowledge. ".repeat(20),
  large: "You are an expert. ".repeat(100),
};
