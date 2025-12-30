/**
 * Application constants module
 * Centralizes all hard-coded values for easy configuration management
 */

export const API_CONSTANTS = {
  VENICE_API_URL: "https://api.venice.ai/api/v1",
  REQUEST_TIMEOUT_MS: 30000, // 30 seconds
  MAX_RETRIES: 3,
  INITIAL_RETRY_DELAY_MS: 2000, // 2 seconds, exponential backoff
} as const;

export const SCHEDULER_CONSTANTS = {
  MIN_DIEM_BALANCE: 0.001, // Minimum balance before stopping
  DEFAULT_INTERVAL_MINUTES: 60, // Test cycle interval (1 hour)
  CLEANUP_INTERVAL_HOURS: 24, // Data cleanup frequency
  DATA_RETENTION_DAYS: 30, // How long to keep old data
  MAX_CONSECUTIVE_FAILURES: 3, // Maximum consecutive failures before skipping a model
  FAILURE_RESET_THRESHOLD: 2, // Number of consecutive successes needed to reset failure count
  BALANCE_RECOVERY_CHECK_INTERVAL_MS: 300000, // Check balance recovery every 5 minutes
  FAILURE_WARNING_THRESHOLD: 3, // Log warning when model reaches this many consecutive failures
  SKIP_COOLDOWN_MS: 2 * 60 * 60 * 1000, // 2 hours cooldown before retrying a skipped model
} as const;

export const SERVER_CONSTANTS = {
  DEFAULT_PORT: 3000,
  DEFAULT_ALLOWED_ORIGINS: [
    "http://localhost:3000",
    "http://localhost:3001",
    "https://signal.venice.guru",
  ],
  CORS_MAX_AGE_SECONDS: 86400, // 24 hours
  DASHBOARD_DIR: "./src/dashboard",
} as const;

export const TEST_CONSTANTS = {
  DEFAULT_DELAY_BETWEEN_MODELS_MS: 10000,
  DEFAULT_DELAY_BETWEEN_REQUESTS_MS: 3000,
  DEFAULT_ISOLATION_DELAY_MS: 15000,
  DEFAULT_MAX_TOKENS: 50,
  DEFAULT_TTL_DELAYS_SECONDS: [5, 30],
  DEFAULT_PERSISTENCE_REQUESTS: 3,
  DEFAULT_BASIC_TEST_REPETITIONS: 1,
} as const;

export const SECURITY_CONSTANTS = {
  RATE_LIMIT_WINDOW_MS: 60000, // 1 minute
  RATE_LIMIT_MAX_REQUESTS: 100, // 100 requests per minute per IP
  RATE_LIMIT_CLEANUP_INTERVAL_MS: 300000, // Clean up old entries every 5 minutes
  MIN_API_KEY_LENGTH: 16, // Minimum length for dashboard API key
  AUTH_HEADER_NAME: "X-API-Key", // Header name for API key authentication
  BYPASS_AUTH_PATHS: ["/cache/health", "/health", "/cache/api/health"], // Paths that bypass authentication
} as const;

/**
 * Cache configuration constants
 * Controls in-memory caching behavior for frequently accessed data
 */
export const CACHE_CONSTANTS = {
  /** Default TTL for cached entries in milliseconds (30 seconds) */
  DEFAULT_TTL_MS: 30000,
  /** Cache key for dashboard statistics */
  STATS_CACHE_KEY: "dashboard:stats",
  /** Cache key for model statistics */
  MODELS_CACHE_KEY: "dashboard:models",
  /** Cache key prefix for sparkline data */
  SPARKLINES_CACHE_KEY: "dashboard:sparklines",
  /** Enable/disable caching globally */
  ENABLE_CACHE: true,
} as const;

/**
 * Metrics configuration constants
 * Controls observability and metrics collection behavior
 */
export const METRICS_CONSTANTS = {
  /** Histogram bucket boundaries in seconds for duration metrics */
  HISTOGRAM_BUCKETS: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  /** Maximum age for metric data in milliseconds (1 hour) */
  MAX_METRIC_AGE_MS: 3600000,
  /** Enable/disable metrics collection globally */
  ENABLE_METRICS: true,
} as const;
