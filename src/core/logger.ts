/**
 * Simple, visible logging for Venice Caching Tests
 * Logs to both console and file with automatic rotation
 * Supports structured JSON output via LOG_FORMAT environment variable
 */

import { appendFileSync, mkdirSync, existsSync, statSync, renameSync, unlinkSync } from "fs";
import { dirname } from "path";
import { env } from "../config/env.ts";

const LOG_FILE = "./data/test.log";
const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_LOG_FILES = 5; // Keep 5 rotated files

// Ensure log directory exists
const logDir = dirname(LOG_FILE);
if (!existsSync(logDir)) {
  mkdirSync(logDir, { recursive: true });
}

type LogLevel = "info" | "error" | "warn";

/**
 * Structured log entry for JSON format output
 */
export interface StructuredLogEntry {
  timestamp: string;
  level: string;
  message: string;
  data?: unknown;
  requestId?: string;
  correlationId?: string;
}

/**
 * Context object for correlation tracking
 */
export interface LogContext {
  requestId?: string;
  correlationId?: string;
}

/**
 * Rotate log file if it exceeds max size
 */
function rotateLogIfNeeded(): void {
  try {
    if (!existsSync(LOG_FILE)) return;

    const stats = statSync(LOG_FILE);
    if (stats.size < MAX_LOG_SIZE_BYTES) return;

    // Rotate: test.log -> test.log.1, test.log.1 -> test.log.2, etc.

    // Delete oldest if at max
    const oldestLog = `${LOG_FILE}.${MAX_LOG_FILES}`;
    if (existsSync(oldestLog)) {
      unlinkSync(oldestLog);
    }

    // Shift existing rotated files
    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const from = `${LOG_FILE}.${i}`;
      const to = `${LOG_FILE}.${i + 1}`;
      if (existsSync(from)) {
        renameSync(from, to);
      }
    }

    // Rotate current log
    renameSync(LOG_FILE, `${LOG_FILE}.1`);

    // Create new empty log
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [INFO] Log rotated\n`);
  } catch (e) {
    console.error("Failed to rotate log:", e);
  }
}

export function log(level: LogLevel, message: string, data?: unknown, context?: LogContext): void {
  const timestamp = new Date().toISOString();

  if (env.logFormat === "json") {
    // Structured JSON format
    const entry: StructuredLogEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
    };
    if (data !== undefined) entry.data = data;
    if (context?.requestId) entry.requestId = context.requestId;
    if (context?.correlationId) entry.correlationId = context.correlationId;

    const jsonLine = JSON.stringify(entry);

    // Console output
    if (level === "error") {
      console.error(jsonLine);
    } else {
      console.log(jsonLine);
    }

    // File output with rotation
    try {
      rotateLogIfNeeded();
      appendFileSync(LOG_FILE, jsonLine + "\n");
    } catch (e) {
      console.error(JSON.stringify({ timestamp, level: "ERROR", message: "Failed to write to log file", data: { error: String(e) } }));
    }
  } else {
    // Text format (original behavior)
    let line = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    if (context?.correlationId) {
      line += ` [${context.correlationId}]`;
    }

    // Console output
    if (level === "error") {
      console.error(line, data ?? "");
    } else {
      console.log(line, data ?? "");
    }

    // File output with rotation
    try {
      rotateLogIfNeeded();
      const fileLine = data ? `${line} ${JSON.stringify(data)}\n` : `${line}\n`;
      appendFileSync(LOG_FILE, fileLine);
    } catch (e) {
      console.error("Failed to write to log file:", e);
    }
  }
}

/**
 * Log with correlation/request ID context
 */
export function logWithContext(level: LogLevel, message: string, context: LogContext, data?: unknown): void {
  log(level, message, data, context);
}

export function logTestResult(result: {
  model: string;
  modelName: string;
  testName: string;
  cachingWorks: boolean;
  cacheHitRate: number | null;
  error?: string | null;
}): void {
  const status = result.error
    ? "ERROR"
    : result.cachingWorks
      ? "CACHE"
      : "NO_CACHE";
  const rate = result.cacheHitRate?.toFixed(1) ?? "0";

  log(
    result.error ? "error" : "info",
    `${result.modelName} | ${result.testName} | ${status} | ${rate}%`,
    result.error ? { error: result.error } : undefined
  );
}

export function logRunStart(): void {
  log("info", "=== Starting test run ===");
}

export function logRunComplete(modelCount: number, withCaching: number): void {
  log("info", `=== Run complete: ${modelCount} models, ${withCaching} with caching ===`);
}

export function logRunError(error: unknown): void {
  log("error", "Run failed", { error: String(error) });
}

/**
 * Get recent log lines from file
 */
export function getRecentLogs(lines: number = 100): string[] {
  try {
    const { readFileSync } = require("fs");
    const content = readFileSync(LOG_FILE, "utf-8");
    const allLines = content.trim().split("\n");
    return allLines.slice(-lines);
  } catch (e) {
    return [];
  }
}
