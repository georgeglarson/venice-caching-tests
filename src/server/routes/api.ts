/**
 * Simplified REST API with input validation and error handling
 */

import { Hono } from "hono";
import {
  getRecentResults,
  getHistory,
  getUsageStats,
  getDailyUsage,
} from "../../db/index.ts";
import {
  getCachedDashboardStats,
  getCachedModelStats,
  getCachedModelSparklines,
} from "../../cache/repository.ts";
import { memoryCache } from "../../cache/memory.ts";
import { CACHE_CONSTANTS } from "../../config/constants.ts";
import { getRecentLogs } from "../../core/logger.ts";
import { metricsCollector } from "../../metrics/collector.ts";
import { scheduler } from "../../scheduler/index.ts";
import { getApiKey, VENICE_API_URL } from "../../core/config.ts";
import { PROMPTS } from "../../core/config.ts";
import { parseJsonResponse, delay } from "../../utils/http.ts";
import { clampInt, safeJsonParse } from "../../utils/validation.ts";
import { env } from "../../config/env.ts";
import { rateLimiter } from "../middleware/rateLimiter.ts";

const api = new Hono();

/**
 * Creates a structured error response with helpful details.
 * Avoids exposing internal error messages in production.
 */
function createErrorResponse(
  baseMessage: string,
  error: unknown,
  includeDetails = process.env.NODE_ENV !== "production"
): { error: string; details?: string; timestamp: string } {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const response: { error: string; details?: string; timestamp: string } = {
    error: baseMessage,
    timestamp: new Date().toISOString(),
  };

  if (includeDetails && errorMessage) {
    response.details = errorMessage;
  }

  return response;
}

// Dashboard overview stats (cached)
api.get("/stats", (c) => {
  try {
    const stats = getCachedDashboardStats();
    return c.json(stats);
  } catch (error) {
    return c.json(createErrorResponse("Failed to load dashboard stats", error), 500);
  }
});

// All models with stats (cached)
api.get("/models", (c) => {
  try {
    const models = getCachedModelStats();
    return c.json(models);
  } catch (error) {
    return c.json(createErrorResponse("Failed to load model stats", error), 500);
  }
});

// Sparkline data for all models (cached)
api.get("/sparklines", (c) => {
  try {
    const limit = clampInt(c.req.query("limit"), 10, 5, 20);
    const sparklines = getCachedModelSparklines(limit);
    return c.json(sparklines);
  } catch (error) {
    return c.json(createErrorResponse("Failed to load sparkline data", error), 500);
  }
});

// Recent test results (for evidence table)
api.get("/results", (c) => {
  try {
    const limit = clampInt(c.req.query("limit"), 100, 1, 1000);
    const results = getRecentResults(limit);
    return c.json(
      results.map((r) => ({
        id: r.id,
        modelId: r.model_id,
        modelName: r.model_name,
        testName: r.test_name,
        cachingWorks: r.caching_works === 1,
        cacheHitRate: r.cache_hit_rate,
        details: safeJsonParse(r.details_json),
        error: r.error,
        testedAt: r.tested_at,
        testRunId: r.test_run_id,
        cacheIsolationNote: r.cache_isolation_note,
      }))
    );
  } catch (error) {
    return c.json(createErrorResponse("Failed to load test results", error), 500);
  }
});

// Cache rate history for charts
api.get("/history", (c) => {
  try {
    const days = clampInt(c.req.query("days"), 30, 1, 365);
    const history = getHistory(days);
    return c.json(history);
  } catch (error) {
    return c.json(createErrorResponse("Failed to load cache history", error), 500);
  }
});

// Recent log lines
api.get("/logs", (c) => {
  try {
    const lines = clampInt(c.req.query("lines"), 100, 1, 500);
    const logs = getRecentLogs(lines);
    return c.json({ logs });
  } catch (error) {
    return c.json(createErrorResponse("Failed to load server logs", error), 500);
  }
});

// Trigger manual test run
api.post("/run", async (c) => {
  try {
    scheduler.run();
    const status = scheduler.getStatus();
    return c.json({
      status: "started",
      queueLength: status.queueLength,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return c.json(createErrorResponse("Failed to start test run", error), 500);
  }
});

// Scheduler status
api.get("/scheduler", (c) => {
  try {
    return c.json(scheduler.getStatus());
  } catch (error) {
    return c.json(createErrorResponse("Failed to get scheduler status", error), 500);
  }
});

// Token usage stats
api.get("/usage", (c) => {
  try {
    const days = clampInt(c.req.query("days"), 30, 1, 365);
    const stats = getUsageStats(days);
    const daily = getDailyUsage(days);
    return c.json({ stats, daily });
  } catch (error) {
    return c.json(createErrorResponse("Failed to load usage stats", error), 500);
  }
});

// Comprehensive health check
api.get("/health", (c) => {
  try {
    const stats = getCachedDashboardStats();
    const schedulerStatus = scheduler.getStatus();

    // Calculate minutes since last test
    let minutesSinceLastTest = Infinity;
    if (stats.lastTestAt) {
      const lastTestTime = new Date(stats.lastTestAt.replace(" ", "T") + "Z").getTime();
      minutesSinceLastTest = (Date.now() - lastTestTime) / 60000;
    }

    // Determine health status
    let status: "healthy" | "degraded" | "unhealthy";
    const issues: string[] = [];

    if (minutesSinceLastTest > 120) {
      status = "unhealthy";
      issues.push(`No tests in ${Math.round(minutesSinceLastTest)} minutes`);
    } else if (minutesSinceLastTest > 60) {
      status = "degraded";
      issues.push(`No tests in ${Math.round(minutesSinceLastTest)} minutes`);
    } else {
      status = "healthy";
    }

    if (!schedulerStatus.enabled) {
      status = "unhealthy";
      issues.push("Scheduler is disabled");
    }

    if (schedulerStatus.queueLength === 0 && stats.totalModels === 0) {
      status = "degraded";
      issues.push("No models in queue");
    }

    const metricsSummary = metricsCollector.getSummary();

    return c.json({
      status,
      timestamp: new Date().toISOString(),
      scheduler: schedulerStatus,
      stats: {
        totalTests: stats.totalTests,
        totalModels: stats.totalModels,
        modelsWithCaching: stats.modelsWithCaching,
        lastTestAt: stats.lastTestAt,
        minutesSinceLastTest: Math.round(minutesSinceLastTest),
      },
      security: {
        authentication: env.dashboardApiKey ? "enabled" : "disabled",
        rateLimiting: "enabled",
        rateLimitStats: rateLimiter.getStats(),
      },
      cache: memoryCache.getStats(),
      metrics: metricsSummary,
      issues: issues.length > 0 ? issues : undefined,
    });
  } catch (error) {
    return c.json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: "Health check failed",
    }, 500);
  }
});

// Cache statistics
api.get("/cache-stats", (c) => {
  try {
    const stats = memoryCache.getStats();
    return c.json({
      enabled: true,
      stats,
      ttl_seconds: CACHE_CONSTANTS.DEFAULT_TTL_MS / 1000,
    });
  } catch (error) {
    return c.json(createErrorResponse("Failed to load cache stats", error), 500);
  }
});

// Prometheus-compatible metrics endpoint
api.get("/metrics", (c) => {
  try {
    const format = c.req.query("format") || "prometheus";
    if (format === "json") {
      return c.json(metricsCollector.getMetrics());
    }
    // Default: Prometheus format
    const metrics = metricsCollector.getPrometheusMetrics();
    return c.text(metrics, 200, {
      "Content-Type": "text/plain; version=0.0.4",
    });
  } catch (error) {
    return c.json(createErrorResponse("Failed to generate metrics", error), 500);
  }
});

// ============ Fresh Models from Venice API ============

api.get("/venice-models", async (c) => {
  try {
    const resp = await fetch(`${VENICE_API_URL}/models`, {
      headers: {
        "Authorization": `Bearer ${getApiKey()}`,
      },
    });

    if (!resp.ok) {
      return c.json({
        error: `Venice API returned HTTP ${resp.status}`,
        timestamp: new Date().toISOString(),
        hint: resp.status === 401 ? "Check your VENICE_API_KEY" : undefined,
      }, 500);
    }

    const data = await parseJsonResponse(resp) as { data?: { id: string; name?: string }[] };
    const models = (data.data || []).map((m) => ({
      id: m.id,
      name: m.name || m.id,
    }));

    return c.json(models);
  } catch (error) {
    return c.json(createErrorResponse("Failed to fetch Venice models", error), 500);
  }
});

// ============ Live Cache Test (Microscope) ============

interface LiveTestRequest {
  prompt_tokens: number;
  cached_tokens: number;
  completion_tokens: number;
  response_time_ms: number;
  raw_usage: unknown;
}

interface LiveTestResult {
  model: string;
  timestamp: string;
  prompt_size: string;
  prompt_tokens_sent: number;
  request1: LiveTestRequest;
  request2: LiveTestRequest;
  cache_working: boolean;
  cache_hit_rate: number;
  delay_between_requests_ms: number;
  request_body: unknown;
  reproducible_curl: string;
}

async function runLiveTest(modelId: string, promptSize: "large" | "xlarge" = "large"): Promise<LiveTestResult> {
  const systemPrompt = PROMPTS[promptSize];
  const userMessage = "Respond with exactly: OK";
  const delayMs = 2000;

  const makeRequest = async (): Promise<{ data: unknown; timeMs: number; error?: string }> => {
    const start = Date.now();
    const resp = await fetch(`${VENICE_API_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: 10,
      }),
    });
    const data = await parseJsonResponse(resp) as { error?: { message?: string } };
    const timeMs = Date.now() - start;

    if (!resp.ok || data.error) {
      return {
        data,
        timeMs,
        error: data.error?.message || `HTTP ${resp.status}`,
      };
    }
    return { data, timeMs };
  };

  // Request 1
  const r1 = await makeRequest();
  if (r1.error) {
    throw new Error(`Request 1 failed: ${r1.error}`);
  }
  const r1Usage = (r1.data as { usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } }).usage;

  // Wait for cache to populate
  await delay(delayMs);

  // Request 2 (identical)
  const r2 = await makeRequest();
  if (r2.error) {
    throw new Error(`Request 2 failed: ${r2.error}`);
  }
  const r2Usage = (r2.data as { usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } }).usage;

  const r2Cached = r2Usage?.prompt_tokens_details?.cached_tokens || 0;
  const r2Prompt = r2Usage?.prompt_tokens || 0;

  const cacheHitRate = r2Prompt > 0 ? (r2Cached / r2Prompt) * 100 : 0;

  // Generate reproducible request body (full JSON for copy/paste)
  const requestBody = {
    model: modelId,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    max_tokens: 10,
  };

  // Generate reproducible test instructions
  const curlCommand = `# Reproducible Cache Test for ${modelId}
# Send this request TWICE with 2 seconds between requests.
# If caching works, the 2nd response should show cached_tokens > 0.

curl -X POST "${VENICE_API_URL}/chat/completions" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d @- << 'EOF'
${JSON.stringify(requestBody, null, 2)}
EOF

# Check the response for:
#   "prompt_tokens_details": { "cached_tokens": <number> }
#
# Request 1: cached_tokens should be 0 (cold cache)
# Request 2: cached_tokens should be > 0 if caching works`;

  return {
    model: modelId,
    timestamp: new Date().toISOString(),
    prompt_size: promptSize,
    prompt_tokens_sent: r1Usage?.prompt_tokens || 0,
    request1: {
      prompt_tokens: r1Usage?.prompt_tokens || 0,
      cached_tokens: r1Usage?.prompt_tokens_details?.cached_tokens || 0,
      completion_tokens: r1Usage?.completion_tokens || 0,
      response_time_ms: r1.timeMs,
      raw_usage: r1Usage,
    },
    request2: {
      prompt_tokens: r2Usage?.prompt_tokens || 0,
      cached_tokens: r2Cached,
      completion_tokens: r2Usage?.completion_tokens || 0,
      response_time_ms: r2.timeMs,
      raw_usage: r2Usage,
    },
    cache_working: r2Cached > 0,
    cache_hit_rate: Math.round(cacheHitRate * 100) / 100,
    delay_between_requests_ms: delayMs,
    request_body: requestBody,
    reproducible_curl: curlCommand,
  };
}

/**
 * Validates a model ID format.
 * Model IDs should be alphanumeric with hyphens, dots, and underscores.
 * Examples: "llama-3.3-70b", "claude-3-5-sonnet", "deepseek-r1"
 */
function isValidModelIdFormat(modelId: string): boolean {
  // Model ID must be 1-100 characters, alphanumeric with hyphens, dots, underscores, and colons
  const modelIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/;
  return modelIdPattern.test(modelId);
}

// Live test single model
api.get("/test/:modelId", async (c) => {
  const modelId = c.req.param("modelId");
  try {
    if (!modelId) {
      return c.json({
        error: "Model ID is required",
        hint: "Provide a valid model ID in the URL path, e.g., /cache/api/test/llama-3.3-70b"
      }, 400);
    }

    if (!isValidModelIdFormat(modelId)) {
      return c.json({
        error: "Invalid model ID format",
        model: modelId,
        hint: "Model ID must be 1-100 characters, starting with alphanumeric, containing only letters, numbers, hyphens, dots, underscores, or colons"
      }, 400);
    }

    const result = await runLiveTest(modelId);
    return c.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Provide helpful error messages based on common failure patterns
    let hint: string | undefined;
    if (errorMessage.includes("model") && (errorMessage.includes("not found") || errorMessage.includes("404"))) {
      hint = "The model ID may not exist. Use /cache/api/venice-models to list available models.";
    } else if (errorMessage.includes("rate") || errorMessage.includes("429")) {
      hint = "Rate limited. Wait a moment before retrying.";
    } else if (errorMessage.includes("timeout")) {
      hint = "Request timed out. The model may be overloaded.";
    }

    return c.json({
      error: `Test failed: ${errorMessage}`,
      model: modelId,
      timestamp: new Date().toISOString(),
      hint
    }, 500);
  }
});

// Compare two models side-by-side
api.get("/compare/:model1/:model2", async (c) => {
  try {
    const model1 = c.req.param("model1");
    const model2 = c.req.param("model2");

    if (!model1 || !model2) {
      return c.json({
        error: "Both model IDs are required",
        hint: "Provide two model IDs in the URL path, e.g., /cache/api/compare/llama-3.3-70b/deepseek-r1"
      }, 400);
    }

    if (!isValidModelIdFormat(model1)) {
      return c.json({
        error: "Invalid model1 ID format",
        model: model1,
        hint: "Model ID must be 1-100 characters, starting with alphanumeric"
      }, 400);
    }

    if (!isValidModelIdFormat(model2)) {
      return c.json({
        error: "Invalid model2 ID format",
        model: model2,
        hint: "Model ID must be 1-100 characters, starting with alphanumeric"
      }, 400);
    }

    // Run tests sequentially to avoid rate limits
    const result1 = await runLiveTest(model1);
    await delay(3000); // Gap between models
    const result2 = await runLiveTest(model2);

    return c.json({
      timestamp: new Date().toISOString(),
      comparison: {
        model1: result1,
        model2: result2,
      },
      summary: {
        model1_caching: result1.cache_working,
        model2_caching: result2.cache_working,
        model1_cache_rate: result1.cache_hit_rate,
        model2_cache_rate: result2.cache_hit_rate,
        conclusion: result1.cache_working === result2.cache_working
          ? "Both models behave the same"
          : `${result1.cache_working ? model1 : model2} has caching, ${result1.cache_working ? model2 : model1} does not`,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return c.json({
      error: `Comparison failed: ${errorMessage}`,
      timestamp: new Date().toISOString()
    }, 500);
  }
});

// Get detailed history for a specific model
api.get("/model/:modelId/history", (c) => {
  try {
    const modelId = c.req.param("modelId");

    if (!modelId || !isValidModelIdFormat(modelId)) {
      return c.json({
        error: "Invalid model ID format",
        hint: "Model ID must be 1-100 characters, starting with alphanumeric"
      }, 400);
    }

    const limit = clampInt(c.req.query("limit"), 50, 1, 200);

    const results = getRecentResults(1000).filter(r => r.model_id === modelId).slice(0, limit);

    // Calculate stats
    const withCaching = results.filter(r => r.caching_works === 1);
    const avgRate = results.length > 0
      ? results.reduce((sum, r) => sum + (r.cache_hit_rate || 0), 0) / results.length
      : 0;

    return c.json({
      model_id: modelId,
      total_tests: results.length,
      tests_with_caching: withCaching.length,
      caching_success_rate: results.length > 0 ? (withCaching.length / results.length) * 100 : 0,
      average_cache_hit_rate: Math.round(avgRate * 100) / 100,
      tests: results.map(r => ({
        id: r.id,
        test_name: r.test_name,
        caching_works: r.caching_works === 1,
        cache_hit_rate: r.cache_hit_rate,
        error: r.error,
        tested_at: r.tested_at,
        details: safeJsonParse(r.details_json),
      })),
    });
  } catch (error) {
    return c.json(createErrorResponse("Failed to load model history", error), 500);
  }
});

export default api;
