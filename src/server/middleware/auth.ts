/**
 * API key authentication middleware for Hono
 * Optional authentication that can be enabled via DASHBOARD_API_KEY env var
 */

import type { Context, Next } from "hono";
import { SECURITY_CONSTANTS } from "../../config/constants.ts";

/**
 * Create authentication middleware
 * @param apiKey - The API key to validate against (if undefined, auth is disabled)
 * @param bypassPaths - Paths that should skip authentication
 */
export function createAuthMiddleware(apiKey?: string, bypassPaths: readonly string[] = []) {
  return async (c: Context, next: Next) => {
    // If no API key configured, skip authentication
    if (!apiKey) {
      await next();
      return;
    }

    // Check if current path should bypass authentication
    const path = c.req.path;
    if (bypassPaths.includes(path)) {
      await next();
      return;
    }

    // Extract API key from header
    const providedKey = c.req.header(SECURITY_CONSTANTS.AUTH_HEADER_NAME);

    // Missing header
    if (!providedKey) {
      return c.json(
        {
          error: "Authentication required",
          message: `Missing ${SECURITY_CONSTANTS.AUTH_HEADER_NAME} header`,
        },
        401
      );
    }

    // Invalid key
    if (providedKey !== apiKey) {
      return c.json(
        {
          error: "Invalid API key",
        },
        403
      );
    }

    // Valid key - proceed
    await next();
  };
}
