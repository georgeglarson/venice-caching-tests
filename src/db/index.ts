/**
 * Database module exports - simplified
 */

export { getDatabase, initDatabase, closeDatabase } from "./migrations.ts";
export { SCHEMA } from "./schema.ts";
export type { TestResultRow } from "./schema.ts";

export {
  saveResult,
  getRecentResults,
  getModelStats,
  getDashboardStats,
  getHistory,
  recordTokenUsage,
  getUsageStats,
  getDailyUsage,
  cleanupOldData,
  getModelSparklines,
} from "./repository.ts";

export type { ModelStats, DashboardStats, TimeSeriesPoint, UsageStats, DailyUsage, CleanupResult, ModelSparklineData } from "./repository.ts";
