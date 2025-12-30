/**
 * Environment variable validation module
 * Validates all environment variables at startup with clear error messages
 */

export interface EnvConfig {
  veniceApiKey: string;
  port: number;
  allowedOrigins: string[];
  nodeEnv?: string;
  debugApiRequests: boolean;
  dashboardApiKey?: string;
  trustProxy: boolean;
  logFormat: 'text' | 'json';
}

/**
 * Validates and returns all environment configuration.
 * Throws descriptive errors for missing or invalid values.
 */
function validateEnv(): EnvConfig {
  // Validate VENICE_API_KEY (required)
  const veniceApiKey = process.env.VENICE_API_KEY || process.env.API_KEY_VENICE;
  if (!veniceApiKey) {
    throw new Error(
      "VENICE_API_KEY environment variable is required. Get your key at https://venice.ai/api"
    );
  }

  // Validate PORT (optional, default: 3000)
  const portStr = process.env.PORT;
  let port = 3000;
  if (portStr) {
    port = parseInt(portStr, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error(
        `PORT must be a number between 1 and 65535, got: ${portStr}`
      );
    }
  }

  // Parse ALLOWED_ORIGINS (optional, default: localhost origins)
  const allowedOriginsStr = process.env.ALLOWED_ORIGINS;
  const allowedOrigins = allowedOriginsStr
    ? allowedOriginsStr.split(",").map((o) => o.trim()).filter((o) => o.length > 0)
    : ["http://localhost:3000", "http://localhost:3001", "https://signal.venice.guru"];

  // Optional NODE_ENV
  const nodeEnv = process.env.NODE_ENV;

  // Parse DEBUG_API_REQUESTS (optional, default: false)
  const debugApiRequestsStr = process.env.DEBUG_API_REQUESTS;
  const debugApiRequests = debugApiRequestsStr === "true" || debugApiRequestsStr === "1";

  // Parse DASHBOARD_API_KEY (optional)
  const dashboardApiKey = process.env.DASHBOARD_API_KEY?.trim();
  if (dashboardApiKey) {
    if (dashboardApiKey.length < 16) {
      throw new Error(
        "DASHBOARD_API_KEY must be at least 16 characters long for security"
      );
    }
  } else {
    console.warn(
      "⚠️  DASHBOARD_API_KEY not set - API authentication is disabled. Set DASHBOARD_API_KEY for production use."
    );
  }

  // Parse TRUST_PROXY (optional, default: false)
  // When true, X-Forwarded-For and X-Real-IP headers will be trusted for rate limiting
  // Only enable this when running behind a trusted reverse proxy (nginx, cloudflare, etc.)
  const trustProxyStr = process.env.TRUST_PROXY;
  const trustProxy = trustProxyStr === "true" || trustProxyStr === "1";

  // Parse LOG_FORMAT (optional, default: 'text')
  // Accepts 'text' or 'json' (case-insensitive)
  const logFormatStr = (process.env.LOG_FORMAT || "text").toLowerCase();
  const logFormat: 'text' | 'json' = logFormatStr === "json" ? "json" : "text";

  return {
    veniceApiKey,
    port,
    allowedOrigins,
    nodeEnv,
    debugApiRequests,
    dashboardApiKey,
    trustProxy,
    logFormat,
  };
}

// Singleton instance - validation happens once at module load time
export const env = validateEnv();
