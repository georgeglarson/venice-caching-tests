/**
 * Venice Caching Health Monitor - Server Entry Point
 */

import app from "./src/server/index.ts";
// Import scheduler to auto-start tests
import { scheduler } from "./src/scheduler/index.ts";
import { closeDatabase } from "./src/db/migrations.ts";

const port = parseInt(process.env.PORT || "3000");

console.log(`
╔══════════════════════════════════════════════════════════════╗
║       Venice Caching Health Monitor Dashboard                ║
╚══════════════════════════════════════════════════════════════╝
`);

console.log(`Starting server on port ${port}...`);

// Graceful shutdown handler
let isShuttingDown = false;

function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n${signal} received. Shutting down gracefully...`);

  // Stop scheduler
  scheduler.stop();

  // Close database connections
  closeDatabase();

  console.log("Shutdown complete.");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

export default {
  port,
  fetch: app.fetch,
};

console.log(`
Dashboard:  http://localhost:${port}
API:        http://localhost:${port}/api/stats
Health:     http://localhost:${port}/health
`);
