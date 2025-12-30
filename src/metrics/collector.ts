/**
 * Centralized metrics collection module
 * Tracks test durations, API timings, cache rates, and error counts
 * Provides Prometheus-compatible metrics export
 */

import { METRICS_CONSTANTS } from "../config/constants.ts";

/**
 * Histogram data structure for tracking distributions
 */
interface HistogramData {
  buckets: Map<number, number>; // bucket upper bound -> count
  sum: number;
  count: number;
}

// Note: Counter data structure intentionally removed - HistogramData is sufficient for current metrics

/**
 * Internal metrics storage
 */
interface MetricsStore {
  // Histograms
  testDuration: Map<string, HistogramData>; // testName -> histogram
  apiResponseTime: Map<string, HistogramData>; // endpoint:statusCode -> histogram

  // Counters
  cacheHits: Map<string, number>; // cacheKey -> count
  cacheMisses: Map<string, number>; // cacheKey -> count
  errors: Map<string, number>; // errorType:modelId -> count
  testResults: Map<string, number>; // testName:success -> count

  // Gauges
  activeTests: number;
  schedulerCycleDuration: HistogramData;
}

/**
 * Centralized metrics collector class
 * Provides methods to record metrics and export in various formats
 */
class MetricsCollector {
  private store: MetricsStore;
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
    this.store = this.createEmptyStore();
  }

  private createEmptyStore(): MetricsStore {
    return {
      testDuration: new Map(),
      apiResponseTime: new Map(),
      cacheHits: new Map(),
      cacheMisses: new Map(),
      errors: new Map(),
      testResults: new Map(),
      activeTests: 0,
      schedulerCycleDuration: this.createHistogram(),
    };
  }

  private createHistogram(): HistogramData {
    const buckets = new Map<number, number>();
    for (const bucket of METRICS_CONSTANTS.HISTOGRAM_BUCKETS) {
      buckets.set(bucket, 0);
    }
    buckets.set(Infinity, 0); // +Inf bucket
    return { buckets, sum: 0, count: 0 };
  }

  private recordHistogram(histogram: HistogramData, value: number): void {
    histogram.sum += value;
    histogram.count++;

    for (const [bucket] of histogram.buckets) {
      if (value <= bucket) {
        histogram.buckets.set(bucket, (histogram.buckets.get(bucket) || 0) + 1);
      }
    }
  }

  /**
   * Record test execution duration
   */
  recordTestDuration(testName: string, durationMs: number): void {
    if (!METRICS_CONSTANTS.ENABLE_METRICS) return;

    const durationSeconds = durationMs / 1000;
    let histogram = this.store.testDuration.get(testName);
    if (!histogram) {
      histogram = this.createHistogram();
      this.store.testDuration.set(testName, histogram);
    }
    this.recordHistogram(histogram, durationSeconds);
  }

  /**
   * Record API response time
   */
  recordApiResponseTime(endpoint: string, durationMs: number, statusCode: number): void {
    if (!METRICS_CONSTANTS.ENABLE_METRICS) return;

    const durationSeconds = durationMs / 1000;
    const key = `${endpoint}:${statusCode}`;
    let histogram = this.store.apiResponseTime.get(key);
    if (!histogram) {
      histogram = this.createHistogram();
      this.store.apiResponseTime.set(key, histogram);
    }
    this.recordHistogram(histogram, durationSeconds);
  }

  /**
   * Record cache hit
   */
  recordCacheHit(cacheKey: string): void {
    if (!METRICS_CONSTANTS.ENABLE_METRICS) return;

    const current = this.store.cacheHits.get(cacheKey) || 0;
    this.store.cacheHits.set(cacheKey, current + 1);
  }

  /**
   * Record cache miss
   */
  recordCacheMiss(cacheKey: string): void {
    if (!METRICS_CONSTANTS.ENABLE_METRICS) return;

    const current = this.store.cacheMisses.get(cacheKey) || 0;
    this.store.cacheMisses.set(cacheKey, current + 1);
  }

  /**
   * Record error occurrence
   */
  recordError(errorType: string, modelId?: string): void {
    if (!METRICS_CONSTANTS.ENABLE_METRICS) return;

    const key = modelId ? `${errorType}:${modelId}` : errorType;
    const current = this.store.errors.get(key) || 0;
    this.store.errors.set(key, current + 1);
  }

  /**
   * Record test result (success/failure)
   */
  recordTestResult(testName: string, success: boolean): void {
    if (!METRICS_CONSTANTS.ENABLE_METRICS) return;

    const key = `${testName}:${success}`;
    const current = this.store.testResults.get(key) || 0;
    this.store.testResults.set(key, current + 1);
  }

  /**
   * Increment active test count
   */
  incrementActiveTests(): void {
    this.store.activeTests++;
  }

  /**
   * Decrement active test count
   */
  decrementActiveTests(): void {
    this.store.activeTests = Math.max(0, this.store.activeTests - 1);
  }

  /**
   * Record scheduler cycle duration
   */
  recordSchedulerCycleDuration(durationMs: number): void {
    if (!METRICS_CONSTANTS.ENABLE_METRICS) return;

    const durationSeconds = durationMs / 1000;
    this.recordHistogram(this.store.schedulerCycleDuration, durationSeconds);
  }

  /**
   * Get all metrics in structured JSON format
   */
  getMetrics(): {
    uptime_seconds: number;
    test_duration: Record<string, { sum: number; count: number; avg: number }>;
    api_response_time: Record<string, { sum: number; count: number; avg: number }>;
    cache_hits_total: Record<string, number>;
    cache_misses_total: Record<string, number>;
    errors_total: Record<string, number>;
    test_results_total: Record<string, number>;
    active_tests: number;
    scheduler_cycle_duration: { sum: number; count: number; avg: number };
  } {
    const uptimeSeconds = (Date.now() - this.startTime) / 1000;

    const formatHistogramSummary = (h: HistogramData) => ({
      sum: h.sum,
      count: h.count,
      avg: h.count > 0 ? h.sum / h.count : 0,
    });

    const testDuration: Record<string, { sum: number; count: number; avg: number }> = {};
    for (const [name, histogram] of this.store.testDuration) {
      testDuration[name] = formatHistogramSummary(histogram);
    }

    const apiResponseTime: Record<string, { sum: number; count: number; avg: number }> = {};
    for (const [key, histogram] of this.store.apiResponseTime) {
      apiResponseTime[key] = formatHistogramSummary(histogram);
    }

    return {
      uptime_seconds: uptimeSeconds,
      test_duration: testDuration,
      api_response_time: apiResponseTime,
      cache_hits_total: Object.fromEntries(this.store.cacheHits),
      cache_misses_total: Object.fromEntries(this.store.cacheMisses),
      errors_total: Object.fromEntries(this.store.errors),
      test_results_total: Object.fromEntries(this.store.testResults),
      active_tests: this.store.activeTests,
      scheduler_cycle_duration: formatHistogramSummary(this.store.schedulerCycleDuration),
    };
  }

  /**
   * Get metrics in Prometheus text format
   */
  getPrometheusMetrics(): string {
    const lines: string[] = [];
    const uptimeSeconds = (Date.now() - this.startTime) / 1000;

    // Uptime
    lines.push("# HELP process_uptime_seconds Time since process started");
    lines.push("# TYPE process_uptime_seconds gauge");
    lines.push(`process_uptime_seconds ${uptimeSeconds.toFixed(3)}`);
    lines.push("");

    // Active tests gauge
    lines.push("# HELP active_tests Number of currently running tests");
    lines.push("# TYPE active_tests gauge");
    lines.push(`active_tests ${this.store.activeTests}`);
    lines.push("");

    // Test duration histogram
    if (this.store.testDuration.size > 0) {
      lines.push("# HELP test_duration_seconds Test execution duration");
      lines.push("# TYPE test_duration_seconds histogram");
      for (const [testName, histogram] of this.store.testDuration) {
        const safeName = testName.replace(/[^a-zA-Z0-9_]/g, "_");
        for (const [bucket, count] of histogram.buckets) {
          const le = bucket === Infinity ? "+Inf" : bucket.toString();
          lines.push(`test_duration_seconds_bucket{test_name="${safeName}",le="${le}"} ${count}`);
        }
        lines.push(`test_duration_seconds_sum{test_name="${safeName}"} ${histogram.sum.toFixed(6)}`);
        lines.push(`test_duration_seconds_count{test_name="${safeName}"} ${histogram.count}`);
      }
      lines.push("");
    }

    // API response time histogram
    if (this.store.apiResponseTime.size > 0) {
      lines.push("# HELP api_response_time_seconds Venice API response time");
      lines.push("# TYPE api_response_time_seconds histogram");
      for (const [key, histogram] of this.store.apiResponseTime) {
        const [endpoint, statusCode] = key.split(":");
        const safeEndpoint = (endpoint || "unknown").replace(/[^a-zA-Z0-9_]/g, "_");
        for (const [bucket, count] of histogram.buckets) {
          const le = bucket === Infinity ? "+Inf" : bucket.toString();
          lines.push(`api_response_time_seconds_bucket{endpoint="${safeEndpoint}",status_code="${statusCode}",le="${le}"} ${count}`);
        }
        lines.push(`api_response_time_seconds_sum{endpoint="${safeEndpoint}",status_code="${statusCode}"} ${histogram.sum.toFixed(6)}`);
        lines.push(`api_response_time_seconds_count{endpoint="${safeEndpoint}",status_code="${statusCode}"} ${histogram.count}`);
      }
      lines.push("");
    }

    // Cache hits counter
    if (this.store.cacheHits.size > 0) {
      lines.push("# HELP cache_hits_total Total number of cache hits");
      lines.push("# TYPE cache_hits_total counter");
      for (const [key, count] of this.store.cacheHits) {
        const safeKey = key.replace(/[^a-zA-Z0-9_]/g, "_");
        lines.push(`cache_hits_total{cache_key="${safeKey}"} ${count}`);
      }
      lines.push("");
    }

    // Cache misses counter
    if (this.store.cacheMisses.size > 0) {
      lines.push("# HELP cache_misses_total Total number of cache misses");
      lines.push("# TYPE cache_misses_total counter");
      for (const [key, count] of this.store.cacheMisses) {
        const safeKey = key.replace(/[^a-zA-Z0-9_]/g, "_");
        lines.push(`cache_misses_total{cache_key="${safeKey}"} ${count}`);
      }
      lines.push("");
    }

    // Errors counter
    if (this.store.errors.size > 0) {
      lines.push("# HELP errors_total Total number of errors by type");
      lines.push("# TYPE errors_total counter");
      for (const [key, count] of this.store.errors) {
        const parts = key.split(":");
        const errorType = parts[0] || "unknown";
        const modelId = parts[1] || "";
        if (modelId) {
          lines.push(`errors_total{error_type="${errorType}",model_id="${modelId}"} ${count}`);
        } else {
          lines.push(`errors_total{error_type="${errorType}"} ${count}`);
        }
      }
      lines.push("");
    }

    // Test results counter
    if (this.store.testResults.size > 0) {
      lines.push("# HELP test_results_total Total number of test results by outcome");
      lines.push("# TYPE test_results_total counter");
      for (const [key, count] of this.store.testResults) {
        const parts = key.split(":");
        const testName = (parts[0] || "unknown").replace(/[^a-zA-Z0-9_]/g, "_");
        const success = parts[1] || "false";
        lines.push(`test_results_total{test_name="${testName}",success="${success}"} ${count}`);
      }
      lines.push("");
    }

    // Scheduler cycle duration
    if (this.store.schedulerCycleDuration.count > 0) {
      lines.push("# HELP scheduler_cycle_duration_seconds Scheduler cycle execution time");
      lines.push("# TYPE scheduler_cycle_duration_seconds histogram");
      const histogram = this.store.schedulerCycleDuration;
      for (const [bucket, count] of histogram.buckets) {
        const le = bucket === Infinity ? "+Inf" : bucket.toString();
        lines.push(`scheduler_cycle_duration_seconds_bucket{le="${le}"} ${count}`);
      }
      lines.push(`scheduler_cycle_duration_seconds_sum ${histogram.sum.toFixed(6)}`);
      lines.push(`scheduler_cycle_duration_seconds_count ${histogram.count}`);
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Get summary statistics for health endpoint
   */
  getSummary(): {
    totalErrors: number;
    avgApiResponseTimeMs: number;
    totalTestRuns: number;
    testSuccessRate: number;
  } {
    let totalErrors = 0;
    for (const count of this.store.errors.values()) {
      totalErrors += count;
    }

    let totalApiCalls = 0;
    let totalApiTime = 0;
    for (const histogram of this.store.apiResponseTime.values()) {
      totalApiCalls += histogram.count;
      totalApiTime += histogram.sum;
    }
    const avgApiResponseTimeMs = totalApiCalls > 0 ? (totalApiTime / totalApiCalls) * 1000 : 0;

    let successCount = 0;
    let failureCount = 0;
    for (const [key, count] of this.store.testResults) {
      if (key.endsWith(":true")) {
        successCount += count;
      } else {
        failureCount += count;
      }
    }
    const totalTestRuns = successCount + failureCount;
    const testSuccessRate = totalTestRuns > 0 ? (successCount / totalTestRuns) * 100 : 0;

    return {
      totalErrors,
      avgApiResponseTimeMs: Math.round(avgApiResponseTimeMs * 100) / 100,
      totalTestRuns,
      testSuccessRate: Math.round(testSuccessRate * 100) / 100,
    };
  }

  /**
   * Reset all metrics (useful for testing)
   */
  reset(): void {
    this.store = this.createEmptyStore();
    this.startTime = Date.now();
  }
}

// Singleton instance
export const metricsCollector = new MetricsCollector();
