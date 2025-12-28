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

// Compute file hashes for cache busting (computed once at startup)
function computeFileHash(filepath: string): string {
  if (!existsSync(filepath)) return "0";
  const content = readFileSync(filepath);
  return createHash("md5").update(content).digest("hex").slice(0, 8);
}

const DASHBOARD_DIR = "./src/dashboard";
const fileHashes = {
  css: computeFileHash(`${DASHBOARD_DIR}/styles.css`),
  js: computeFileHash(`${DASHBOARD_DIR}/app.js`),
};

const app = new Hono();

// Allowed origins for CORS (configurable via environment)
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://localhost:3001", "https://signal.venice.guru"];

// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => {
      // Allow requests with no origin (same-origin, curl, etc.)
      if (!origin) return "*";
      // Check if origin is in allowed list
      if (allowedOrigins.includes(origin)) return origin;
      // In development, allow all localhost origins
      if (origin.startsWith("http://localhost:")) return origin;
      // Reject unknown origins
      return null;
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400, // 24 hours
  })
);

// All routes under /cache base path for deployment at signal.venice.guru/cache/

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
