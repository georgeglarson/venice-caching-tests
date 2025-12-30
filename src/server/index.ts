/**
 * Hono Web Server for Venice Caching Health Monitor
 * Simplified - no SSE, no run management, just API + static files
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveStatic } from "hono/bun";
import api from "./routes/api.ts";
import { createHash } from "crypto";
import { readFileSync, existsSync } from "fs";
import { env } from "../config/env.ts";
import { SERVER_CONSTANTS, SECURITY_CONSTANTS } from "../config/constants.ts";
import { createRateLimitMiddleware, rateLimiter } from "./middleware/rateLimiter.ts";
import { createAuthMiddleware } from "./middleware/auth.ts";

// Compute file hashes for cache busting (computed once at startup)
function computeFileHash(filepath: string): string {
  if (!existsSync(filepath)) return "0";
  const content = readFileSync(filepath);
  return createHash("md5").update(content).digest("hex").slice(0, 8);
}

const DASHBOARD_DIR = SERVER_CONSTANTS.DASHBOARD_DIR;
const fileHashes = {
  css: computeFileHash(`${DASHBOARD_DIR}/styles.css`),
  js: computeFileHash(`${DASHBOARD_DIR}/app.js`),
};

const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => {
      // Allow requests with no origin (same-origin, curl, etc.)
      if (!origin) return "*";
      // Check if origin is in allowed list
      if (env.allowedOrigins.includes(origin)) return origin;
      // In development, allow all localhost origins
      // In production, only allow configured origins (no localhost wildcards)
      if (env.nodeEnv !== "production" && origin.startsWith("http://localhost:")) {
        return origin;
      }
      // Reject unknown origins
      return null;
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", SECURITY_CONSTANTS.AUTH_HEADER_NAME],
    maxAge: SERVER_CONSTANTS.CORS_MAX_AGE_SECONDS,
  })
);

// Rate limiting middleware (bypass health check endpoints to avoid 429 for probes)
app.use("*", createRateLimitMiddleware(SECURITY_CONSTANTS.BYPASS_AUTH_PATHS));

// Authentication middleware
app.use("*", createAuthMiddleware(env.dashboardApiKey, SECURITY_CONSTANTS.BYPASS_AUTH_PATHS));

// All routes under /cache base path for deployment at signal.venice.guru/cache/

// Rate limit stats endpoint
app.get("/cache/api/rate-limit-stats", (c) => {
  const stats = rateLimiter.getStats();
  return c.json(stats);
});

// API routes
app.route("/cache/api", api);

// Serve static dashboard files
app.use("/cache/static/*", serveStatic({
  root: "./src/dashboard",
  rewriteRequestPath: (path) => path.replace(/^\/cache\/static/, "")
}));

// Serve dashboard HTML with hash-based cache busting
function getHtmlWithHashes(): string {
  let html = readFileSync(`${DASHBOARD_DIR}/index.html`, "utf-8");
  // Replace version placeholders with hashes
  html = html.replace(/styles\.css\?v=[^"]+/, `styles.css?v=${fileHashes.css}`);
  html = html.replace(/app\.js\?v=[^"]+/, `app.js?v=${fileHashes.js}`);
  return html;
}

app.get("/cache", (c) => c.html(getHtmlWithHashes()));
app.get("/cache/", (c) => c.html(getHtmlWithHashes()));

// Health check
app.get("/cache/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// Root redirect to /cache/
app.get("/", (c) => c.redirect("/cache/"));

// Root health check for monitoring
app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

export default app;
export { app };
