/**
 * Simple scheduler - test one model at a time, save immediately
 */

import { fetchModels, testModel } from "../core/runner.ts";
import { fetchDiemBalance } from "../core/api.ts";
import { DEFAULT_CONFIG } from "../core/config.ts";
import { SCHEDULER_CONSTANTS } from "../config/constants.ts";
import { saveResult, recordTokenUsage, cleanupOldData } from "../db/index.ts";
import { log, logTestResult } from "../core/logger.ts";
import { memoryCache } from "../cache/memory.ts";
import { metricsCollector } from "../metrics/collector.ts";
import type { TestConfig, TestResult, VeniceModel, UsageInfo } from "../core/types.ts";
import type { RequestResult, ErrorType } from "../core/api.ts";

/**
 * Tracks failure information for a model
 */
interface ModelFailureInfo {
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastError: string | null;
  lastErrorType: ErrorType | null;
  lastErrorTime: Date | null;
  totalFailures: number;
  skipUntil: Date | null; // Cooldown timestamp - model will be skipped until this time
}

/**
 * Extract the latest diem balance from test details
 */
function extractDiemBalance(test: TestResult): number | null {
  const details = test.details;
  if (!details) return null;

  let latestBalance: number | null = null;

  const checkUsage = (usage: UsageInfo | undefined) => {
    if (usage?.diemBalance !== undefined) {
      latestBalance = usage.diemBalance;
    }
  };

  // Check all possible locations for usage data
  const firstReq = details.firstRequest as RequestResult | undefined;
  const secondReq = details.secondRequest as RequestResult | undefined;
  if (firstReq) checkUsage(firstReq.usage);
  if (secondReq) checkUsage(secondReq.usage);

  const requests = details.requests as Array<RequestResult & { attempt: number }> | undefined;
  if (requests) {
    for (const req of requests) {
      checkUsage(req.usage);
    }
  }

  const sizes = details.sizes as Record<string, { firstRequest: RequestResult; secondRequest: RequestResult }> | undefined;
  if (sizes) {
    for (const sizeData of Object.values(sizes)) {
      if (sizeData.firstRequest) checkUsage(sizeData.firstRequest.usage);
      if (sizeData.secondRequest) checkUsage(sizeData.secondRequest.usage);
    }
  }

  const delays = details.delays as Record<string, { firstRequest: RequestResult; secondRequest: RequestResult }> | undefined;
  if (delays) {
    for (const delayData of Object.values(delays)) {
      if (delayData.firstRequest) checkUsage(delayData.firstRequest.usage);
      if (delayData.secondRequest) checkUsage(delayData.secondRequest.usage);
    }
  }

  return latestBalance;
}

/**
 * Extract all usage info from test details and record to database
 */
function recordUsageFromTest(test: TestResult): void {
  const modelId = test.model;
  const details = test.details;

  if (!details) return;

  // Helper to record usage if valid
  const record = (usage: UsageInfo | undefined) => {
    if (usage && (usage.promptTokens > 0 || usage.completionTokens > 0)) {
      recordTokenUsage(modelId, usage);
    }
  };

  // Direct requests (basic, partial_cache)
  const firstReq = details.firstRequest as RequestResult | undefined;
  const secondReq = details.secondRequest as RequestResult | undefined;
  if (firstReq) record(firstReq.usage);
  if (secondReq) record(secondReq.usage);

  // Requests array (persistence)
  const requests = details.requests as Array<RequestResult & { attempt: number }> | undefined;
  if (requests) {
    for (const req of requests) {
      record(req.usage);
    }
  }

  // Sizes object (prompt_sizes)
  const sizes = details.sizes as Record<string, { firstRequest: RequestResult; secondRequest: RequestResult }> | undefined;
  if (sizes) {
    for (const sizeData of Object.values(sizes)) {
      if (sizeData.firstRequest) record(sizeData.firstRequest.usage);
      if (sizeData.secondRequest) record(sizeData.secondRequest.usage);
    }
  }

  // Delays object (ttl)
  const delays = details.delays as Record<string, { firstRequest: RequestResult; secondRequest: RequestResult }> | undefined;
  if (delays) {
    for (const delayData of Object.values(delays)) {
      if (delayData.firstRequest) record(delayData.firstRequest.usage);
      if (delayData.secondRequest) record(delayData.secondRequest.usage);
    }
  }
}


class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private balanceCheckTimer: ReturnType<typeof setInterval> | null = null;
  private cacheCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private intervalMinutes: number;
  private config: TestConfig;
  private modelQueue: VeniceModel[] = [];
  private isProcessing = false;
  private lastDiemBalance: number | null = null;
  private stoppedDueToBalance = false;
  private modelFailures: Map<string, ModelFailureInfo> = new Map();
  private errorAggregation: Map<string, number> = new Map();

  constructor(intervalMinutes: number, config: TestConfig) {
    this.intervalMinutes = intervalMinutes;
    this.config = config;
  }

  private recordModelFailure(modelId: string, error: string, errorType: ErrorType | null): void {
    let info = this.modelFailures.get(modelId);
    if (!info) {
      info = {
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        lastError: null,
        lastErrorType: null,
        lastErrorTime: null,
        totalFailures: 0,
        skipUntil: null,
      };
      this.modelFailures.set(modelId, info);
    }

    info.consecutiveFailures++;
    info.totalFailures++;
    info.consecutiveSuccesses = 0;
    info.lastError = error;
    info.lastErrorType = errorType;
    info.lastErrorTime = new Date();

    // Increment error type count in aggregation
    if (errorType) {
      const count = this.errorAggregation.get(errorType) || 0;
      this.errorAggregation.set(errorType, count + 1);
    }

    // Log warning if failures reach threshold
    if (info.consecutiveFailures >= SCHEDULER_CONSTANTS.FAILURE_WARNING_THRESHOLD) {
      log("warn", `Model ${modelId} has ${info.consecutiveFailures} consecutive failures`, {
        errorType: errorType || "unknown",
        lastError: error,
      });
    }

    // Set cooldown when model reaches max consecutive failures
    if (info.consecutiveFailures >= SCHEDULER_CONSTANTS.MAX_CONSECUTIVE_FAILURES) {
      info.skipUntil = new Date(Date.now() + SCHEDULER_CONSTANTS.SKIP_COOLDOWN_MS);
      log("info", `Model ${modelId} will be skipped until ${info.skipUntil.toISOString()}`);
    }
  }

  private recordModelSuccess(modelId: string): void {
    const info = this.modelFailures.get(modelId);
    if (!info) {
      return; // No failure record, nothing to update
    }

    const previousFailures = info.consecutiveFailures;
    info.consecutiveSuccesses++;

    // Reset failure count if enough consecutive successes
    if (info.consecutiveSuccesses >= SCHEDULER_CONSTANTS.FAILURE_RESET_THRESHOLD) {
      if (previousFailures > 0) {
        log("info", `Model ${modelId} recovered after ${previousFailures} consecutive failures`);
      }
      info.consecutiveFailures = 0;
      info.skipUntil = null; // Clear cooldown on recovery
    } else if (previousFailures > 0) {
      log("info", `Model ${modelId} succeeded (${info.consecutiveSuccesses}/${SCHEDULER_CONSTANTS.FAILURE_RESET_THRESHOLD} needed to reset failure count)`);
    }
  }

  start(): void {
    if (this.timer) clearInterval(this.timer);

    // Clear balance check timer if it exists
    if (this.balanceCheckTimer) {
      clearInterval(this.balanceCheckTimer);
      this.balanceCheckTimer = null;
    }

    // Reset stopped-due-to-balance flag when manually restarted
    this.stoppedDueToBalance = false;

    log("info", `Scheduler started: cycling through models`);

    // Refresh model list periodically
    this.timer = setInterval(
      () => this.refreshModels(),
      this.intervalMinutes * 60 * 1000
    );

    // Run cleanup once per day
    if (!this.cleanupTimer) {
      // Run cleanup on startup
      this.runCleanup();
      // Then run every CLEANUP_INTERVAL_HOURS
      this.cleanupTimer = setInterval(
        () => this.runCleanup(),
        SCHEDULER_CONSTANTS.CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000
      );
    }

    // Periodic cleanup of expired cache entries to prevent memory leaks
    if (!this.cacheCleanupTimer) {
      // Run cache cleanup on startup
      memoryCache.cleanup();
      // Then run every 5 minutes
      this.cacheCleanupTimer = setInterval(
        () => memoryCache.cleanup(),
        300000 // 5 minutes
      );
    }

    // Start processing immediately
    this.refreshModels();
  }

  /**
   * Maximum number of model failure entries to keep in memory.
   * If exceeded, entries with no recent failures are evicted.
   */
  private static readonly MAX_FAILURE_ENTRIES = 100;

  private runCleanup(): void {
    const result = cleanupOldData(SCHEDULER_CONSTANTS.DATA_RETENTION_DAYS);
    if (result.testResultsDeleted > 0 || result.tokenUsageDeleted > 0) {
      log("info", `Cleanup: deleted ${result.testResultsDeleted} test results, ${result.tokenUsageDeleted} usage records older than ${SCHEDULER_CONSTANTS.DATA_RETENTION_DAYS} days`);
    }

    // Clean up failure tracking data
    this.cleanupModelFailures();
  }

  /**
   * Cleans up the modelFailures Map to prevent unbounded memory growth.
   * Removes entries:
   * 1. Older than 7 days with no recent errors
   * 2. With zero consecutive failures (recovered models)
   * 3. If map exceeds MAX_FAILURE_ENTRIES, evicts least recently failed entries
   */
  private cleanupModelFailures(): void {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    let cleanedRecords = 0;

    // First pass: remove old entries and recovered models
    for (const [modelId, info] of this.modelFailures) {
      const isOld = info.lastErrorTime && info.lastErrorTime < sevenDaysAgo;
      const isRecovered = info.consecutiveFailures === 0 && info.consecutiveSuccesses >= SCHEDULER_CONSTANTS.FAILURE_RESET_THRESHOLD;

      if (isOld || isRecovered) {
        this.modelFailures.delete(modelId);
        cleanedRecords++;
      }
    }

    // Second pass: if still over limit, evict least recently failed entries
    if (this.modelFailures.size > Scheduler.MAX_FAILURE_ENTRIES) {
      const entries = Array.from(this.modelFailures.entries())
        .sort((a, b) => {
          const timeA = a[1].lastErrorTime?.getTime() ?? 0;
          const timeB = b[1].lastErrorTime?.getTime() ?? 0;
          return timeA - timeB; // Oldest first
        });

      const toRemove = entries.slice(0, this.modelFailures.size - Scheduler.MAX_FAILURE_ENTRIES);
      for (const [modelId] of toRemove) {
        this.modelFailures.delete(modelId);
        cleanedRecords++;
      }
    }

    if (cleanedRecords > 0) {
      log("info", `Cleanup: removed ${cleanedRecords} failure tracking records (${this.modelFailures.size} remaining)`);
    }

    // Also clean up error aggregation if it's growing too large
    if (this.errorAggregation.size > 20) {
      this.errorAggregation.clear();
      log("info", "Cleanup: reset error aggregation counters");
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log("info", "Scheduler stopped");
    }
    // Clear balance check timer if it exists
    if (this.balanceCheckTimer) {
      clearInterval(this.balanceCheckTimer);
      this.balanceCheckTimer = null;
    }
    // Clear cache cleanup timer if it exists
    if (this.cacheCleanupTimer) {
      clearInterval(this.cacheCleanupTimer);
      this.cacheCleanupTimer = null;
    }
  }

  private startBalanceRecoveryCheck(): void {
    // Only start if stopped due to balance
    if (!this.stoppedDueToBalance) {
      return;
    }

    // Don't create multiple timers
    if (this.balanceCheckTimer) {
      return;
    }

    log("info", "Starting balance recovery check");

    this.balanceCheckTimer = setInterval(async () => {
      // Fetch fresh balance from the API
      const freshBalance = await fetchDiemBalance();
      if (freshBalance !== null) {
        this.lastDiemBalance = freshBalance;
      }

      // Check if balance has recovered
      if (this.lastDiemBalance !== null && this.lastDiemBalance >= SCHEDULER_CONSTANTS.MIN_DIEM_BALANCE) {
        log("info", `Balance recovered to ${this.lastDiemBalance.toFixed(6)}, restarting scheduler`);
        // Clear the balance check timer before restarting to avoid duplicate timers
        if (this.balanceCheckTimer) {
          clearInterval(this.balanceCheckTimer);
          this.balanceCheckTimer = null;
        }
        this.start();
      }
    }, SCHEDULER_CONSTANTS.BALANCE_RECOVERY_CHECK_INTERVAL_MS);
  }

  private async refreshModels(): Promise<void> {
    try {
      const allModels = await fetchModels();
      const textModels = allModels.filter((m) => m.type === "text");

      // Add models to queue (only if not already in queue)
      const existingIds = new Set(this.modelQueue.map(m => m.id));
      for (const model of textModels) {
        if (!existingIds.has(model.id)) {
          this.modelQueue.push(model);
        }
      }

      log("info", `Model queue: ${this.modelQueue.length} models`);

      // Log error aggregation if any errors tracked
      if (this.errorAggregation.size > 0) {
        log("warn", this.getErrorAggregationReport());
      }

      // Log failed/skipped model counts if any
      const status = this.getStatus();
      if (status.failedModels > 0 || status.skippedModels > 0) {
        log("info", `Model status: ${status.failedModels} failed, ${status.skippedModels} skipped`);
      }

      // Start processing if not already
      if (!this.isProcessing) {
        this.processNext();
      }
    } catch (error) {
      log("error", "Failed to fetch models", { error: String(error) });
    }
  }

  private async processNext(): Promise<void> {
    if (this.modelQueue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const model = this.modelQueue.shift()!;
    const cycleStartTime = Date.now();

    // Check if model has too many consecutive failures and cooldown hasn't expired
    const failureInfo = this.modelFailures.get(model.id);
    if (failureInfo && failureInfo.consecutiveFailures >= SCHEDULER_CONSTANTS.MAX_CONSECUTIVE_FAILURES) {
      const now = new Date();
      // Skip only if cooldown hasn't expired yet
      if (failureInfo.skipUntil && now < failureInfo.skipUntil) {
        log("warn", `Skipping model ${model.model_spec?.name || model.id} due to ${failureInfo.consecutiveFailures} consecutive failures (cooldown until ${failureInfo.skipUntil.toISOString()})`);
        // Re-add model to end of queue for retry after cooldown
        this.modelQueue.push(model);
        // Skip to next model immediately (no isolation delay)
        setImmediate(() => this.processNext());
        return;
      }
      // Cooldown expired - allow retry and reset cooldown timer
      log("info", `Retrying model ${model.model_spec?.name || model.id} after cooldown expired`);
      failureInfo.skipUntil = null;
    }

    try {
      log("info", `Testing: ${model.model_spec?.name || model.id}`);

      // Generate a fresh test run ID for each model to ensure cache isolation
      const testConfig = {
        ...this.config,
        testRunId: crypto.randomUUID(),
      };

      const result = await testModel(model, { config: testConfig });

      // Save each test result immediately and record token usage
      for (const test of result.tests) {
        saveResult(test, result.modelName);
        recordUsageFromTest(test);
        logTestResult({
          model: test.model,
          modelName: result.modelName,
          testName: test.testName,
          cachingWorks: test.cachingWorks,
          cacheHitRate: test.cacheHitRate,
          error: test.error,
        });

        // Track diem balance from test results
        const balance = extractDiemBalance(test);
        if (balance !== null) {
          this.lastDiemBalance = balance;
        }
      }

      // Check if diem balance is too low
      if (this.lastDiemBalance !== null && this.lastDiemBalance < SCHEDULER_CONSTANTS.MIN_DIEM_BALANCE) {
        log("warn", `Diem balance too low (${this.lastDiemBalance.toFixed(6)}), minimum required: ${SCHEDULER_CONSTANTS.MIN_DIEM_BALANCE}`);
        this.stoppedDueToBalance = true;
        this.stop();
        this.startBalanceRecoveryCheck();
        this.isProcessing = false;
        return;
      }

      // Record success for this model
      this.recordModelSuccess(model.id);

      // Re-add model to end of queue for next round
      this.modelQueue.push(model);

      // Record scheduler cycle duration
      const cycleDuration = Date.now() - cycleStartTime;
      metricsCollector.recordSchedulerCycleDuration(cycleDuration);

    } catch (error) {
      const errorMessage = String(error);
      // Extract error type if available from structured error
      let errorType: ErrorType | null = null;
      if (error && typeof error === "object" && "errorType" in error) {
        errorType = (error as { errorType: ErrorType }).errorType;
      }

      log("error", `Failed testing ${model.id}`, { error: errorMessage });

      // Record failure for this model
      this.recordModelFailure(model.id, errorMessage, errorType);

      // Record scheduler cycle duration even on failure
      const cycleDuration = Date.now() - cycleStartTime;
      metricsCollector.recordSchedulerCycleDuration(cycleDuration);

      // Check if model will be skipped next time
      const info = this.modelFailures.get(model.id);
      if (info && info.consecutiveFailures >= SCHEDULER_CONSTANTS.MAX_CONSECUTIVE_FAILURES) {
        log("info", `Model ${model.id} will be skipped on next attempt due to reaching ${SCHEDULER_CONSTANTS.MAX_CONSECUTIVE_FAILURES} consecutive failures`);
      }

      // Still re-add to queue
      this.modelQueue.push(model);
    }

    // Use isolation delay between models for proper cache isolation
    // Only continue if scheduler is still enabled
    if (this.timer === null) {
      this.isProcessing = false;
      return;
    }

    const isolationDelay = this.config.isolationDelay ?? 5000;
    log("info", `Waiting ${isolationDelay}ms for cache isolation...`);
    setTimeout(() => this.processNext(), isolationDelay);
  }

  async run(): Promise<void> {
    await this.refreshModels();
  }

  private getErrorAggregationReport(): string {
    if (this.errorAggregation.size === 0) {
      return "";
    }

    const parts: string[] = [];
    for (const [errorType, count] of this.errorAggregation) {
      parts.push(`${errorType}: ${count}`);
    }
    return `Error summary: ${parts.join(", ")}`;
  }

  getStatus(): {
    enabled: boolean;
    intervalMinutes: number;
    queueLength: number;
    stoppedDueToBalance: boolean;
    failedModels: number;
    skippedModels: number;
    errorSummary: string;
  } {
    let failedModels = 0;
    let skippedModels = 0;

    for (const info of this.modelFailures.values()) {
      if (info.consecutiveFailures > 0) {
        failedModels++;
      }
      if (info.consecutiveFailures >= SCHEDULER_CONSTANTS.MAX_CONSECUTIVE_FAILURES) {
        skippedModels++;
      }
    }

    return {
      enabled: this.timer !== null,
      intervalMinutes: this.intervalMinutes,
      queueLength: this.modelQueue.length,
      stoppedDueToBalance: this.stoppedDueToBalance,
      failedModels,
      skippedModels,
      errorSummary: this.getErrorAggregationReport(),
    };
  }

  public getModelFailureInfo(modelId: string): ModelFailureInfo | undefined {
    return this.modelFailures.get(modelId);
  }

  public getAllFailedModels(): Array<{ modelId: string; info: ModelFailureInfo }> {
    const result: Array<{ modelId: string; info: ModelFailureInfo }> = [];
    for (const [modelId, info] of this.modelFailures) {
      if (info.consecutiveFailures > 0) {
        result.push({ modelId, info });
      }
    }
    return result;
  }
}

// Global scheduler instance
export const scheduler = new Scheduler(SCHEDULER_CONSTANTS.DEFAULT_INTERVAL_MINUTES, DEFAULT_CONFIG);

// Auto-start on import
scheduler.start();
