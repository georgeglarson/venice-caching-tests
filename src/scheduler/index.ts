/**
 * Simple scheduler - test one model at a time, save immediately
 */

import { fetchModels, testModel } from "../core/runner.ts";
import { DEFAULT_CONFIG } from "../core/config.ts";
import { saveResult, recordTokenUsage, cleanupOldData } from "../db/index.ts";
import { log, logTestResult } from "../core/logger.ts";
import type { TestConfig, TestResult, VeniceModel, UsageInfo } from "../core/types.ts";
import type { RequestResult } from "../core/api.ts";

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

// Minimum diem balance before stopping (to avoid spamming with no credits)
const MIN_DIEM_BALANCE = 0.001;

class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private intervalMinutes: number;
  private config: TestConfig;
  private modelQueue: VeniceModel[] = [];
  private isProcessing = false;
  private lastDiemBalance: number | null = null;
  private stoppedDueToBalance = false;

  constructor(intervalMinutes: number, config: TestConfig) {
    this.intervalMinutes = intervalMinutes;
    this.config = config;
  }

  start(): void {
    if (this.timer) clearInterval(this.timer);

    // Reset stopped-due-to-balance flag when manually restarted
    this.stoppedDueToBalance = false;

    log("info", `Scheduler started: cycling through models`);

    // Refresh model list periodically
    this.timer = setInterval(
      () => this.refreshModels(),
      this.intervalMinutes * 60 * 1000
    );

    // Run cleanup once per day (86400000ms = 24 hours)
    if (!this.cleanupTimer) {
      // Run cleanup on startup
      this.runCleanup();
      // Then run every 24 hours
      this.cleanupTimer = setInterval(() => this.runCleanup(), 24 * 60 * 60 * 1000);
    }

    // Start processing immediately
    this.refreshModels();
  }

  private runCleanup(): void {
    const result = cleanupOldData(30);
    if (result.testResultsDeleted > 0 || result.tokenUsageDeleted > 0) {
      log("info", `Cleanup: deleted ${result.testResultsDeleted} test results, ${result.tokenUsageDeleted} usage records older than 30 days`);
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log("info", "Scheduler stopped");
    }
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
      if (this.lastDiemBalance !== null && this.lastDiemBalance < MIN_DIEM_BALANCE) {
        log("warn", `Diem balance too low (${this.lastDiemBalance.toFixed(6)}), stopping scheduler to avoid spamming servers`);
        this.stoppedDueToBalance = true;
        this.stop();
        this.isProcessing = false;
        return;
      }

      // Re-add model to end of queue for next round
      this.modelQueue.push(model);

    } catch (error) {
      log("error", `Failed testing ${model.id}`, { error: String(error) });
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

  getStatus(): {
    enabled: boolean;
    intervalMinutes: number;
    queueLength: number;
    stoppedDueToBalance: boolean;
  } {
    return {
      enabled: this.timer !== null,
      intervalMinutes: this.intervalMinutes,
      queueLength: this.modelQueue.length,
      stoppedDueToBalance: this.stoppedDueToBalance,
    };
  }
}

// Global scheduler instance
export const scheduler = new Scheduler(10, DEFAULT_CONFIG);

// Auto-start on import
scheduler.start();
