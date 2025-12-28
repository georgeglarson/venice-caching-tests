/**
 * Core types for Venice Caching Test Suite
 */

import type { RequestPayload, ErrorType } from "./api.ts";

export interface UsageInfo {
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  diemBalance?: number;  // Venice account balance from x-venice-balance-diem header
}

export interface TestResult {
  testName: string;
  model: string;
  success: boolean;
  cachingWorks: boolean;
  cacheHitRate: number | null;
  details: Record<string, unknown>;
  error?: string;
  attemptedCount?: number;
  failedCount?: number;
  errors?: Array<{ attempt: string | number; error: string; errorType?: ErrorType }>;
  testRunId?: string;                 // The test run ID used for this test (for tracking cache isolation)
  cacheIsolationNote?: string;        // Documentation about cache persistence behavior observed
}

export interface ModelResults {
  model: string;
  modelName: string;
  tests: TestResult[];
  overallCachingSupport: boolean;
  bestCacheRate: number;
  cachingReliabilityScore: number;  // 0-100 score indicating caching reliability
}

export interface TestConfig {
  runBasicTest: boolean;
  runPromptSizeTest: boolean;
  runPartialCacheTest: boolean;
  runPersistenceTest: boolean;
  runTTLTest: boolean;
  maxModels: number;
  delayBetweenModels: number;
  selectedModels?: string[];
  cachingSupportThreshold: {
    minTestsWithCaching: number;      // Minimum tests that must show caching (e.g., 3)
    minCacheHitRate: number;          // Minimum cache hit rate % to count as working (e.g., 50)
    minSuccessRate: number;           // Minimum % of tests that must succeed (e.g., 60)
  };
  maxTokens?: number;                                    // Max tokens for API responses (defaults to 50)
  cacheControlPlacement?: 'system' | 'user' | 'both';    // Where to apply cache_control (defaults to 'system')
  delayBetweenRequests?: number;                         // Delay between requests in milliseconds
  ttlDelays?: number[];                                  // TTL test delays in seconds (defaults to [1, 5, 10, 30])
  testRunId?: string;                                    // Unique identifier for each test run (UUID or timestamp-based)
  isolationDelay?: number;                               // Delay in milliseconds between model tests to ensure cache isolation (default: 5000ms)
  injectTestRunId?: boolean;                             // Whether to inject test run ID into prompts for cache isolation (default: true)
  persistenceRequests?: number;                          // Number of requests in persistence test (default: 10)
  basicTestRepetitions?: number;                         // Number of times to repeat basic test for larger sample (default: 1)
}

export interface VeniceModel {
  id: string;
  type: string;
  model_spec?: {
    name?: string;
  };
}

export interface TestProgressEvent {
  runId?: number;
  modelId: string;
  modelName: string;
  testName: string;
  status: "started" | "completed" | "failed";
  result?: TestResult;
  progress: { completed: number; total: number };
  timestamp?: string;
  requestPayload?: RequestPayload;
  responseUsage?: UsageInfo;
  errorMessage?: string;
}

export type TestProgressCallback = (event: TestProgressEvent) => void;
