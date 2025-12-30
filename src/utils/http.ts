/**
 * HTTP utility functions for API requests
 * Provides shared HTTP-related functionality including timeout handling,
 * JSON response parsing, and delay utilities.
 */

import { API_CONSTANTS } from "../config/constants.ts";

/**
 * Creates a fetch request with timeout using AbortController.
 * Automatically aborts the request if it exceeds the specified timeout.
 *
 * @param url - The URL to fetch
 * @param options - Standard fetch RequestInit options
 * @param timeoutMs - Timeout in milliseconds (defaults to API_CONSTANTS.REQUEST_TIMEOUT_MS)
 * @returns Promise resolving to the Response object
 * @throws AbortError if the request times out
 * @example
 * const response = await fetchWithTimeout('/api/data', { method: 'GET' }, 5000);
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = API_CONSTANTS.REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Delays execution for specified milliseconds.
 * Simple promise-based delay utility for use with async/await.
 *
 * @param ms - Number of milliseconds to delay
 * @returns Promise that resolves after the specified delay
 * @example
 * await delay(1000); // Wait 1 second
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parses JSON response with content-type validation.
 * Throws a descriptive error if the response is not JSON (e.g., HTML error page).
 *
 * @param response - The fetch Response object to parse
 * @returns Promise resolving to the parsed JSON data
 * @throws Error if Content-Type is not application/json, includes status and full body
 * @example
 * const response = await fetch('/api/data');
 * const data = await parseJsonResponse(response);
 */
export async function parseJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("Content-Type") || "";

  if (!contentType.includes("application/json")) {
    const text = await response.text();
    const isHtml = text.trimStart().startsWith("<!") || text.trimStart().startsWith("<html");
    const cfRay = response.headers.get("cf-ray");
    const cfCacheStatus = response.headers.get("cf-cache-status");

    // Build detailed error message
    let errorMsg = `Non-JSON response (status ${response.status}, content-type: ${contentType || "none"})`;

    if (cfRay) {
      errorMsg += `\n  Cloudflare Ray ID: ${cfRay}`;
    }
    if (cfCacheStatus) {
      errorMsg += `\n  CF Cache Status: ${cfCacheStatus}`;
    }

    if (isHtml) {
      // Extract title from HTML if present
      const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch?.[1]?.trim();
      if (title) {
        errorMsg += `\n  Page Title: ${title}`;
      }

      // Check for common error patterns
      if (text.includes("challenge-platform") || text.includes("cf-browser-verification")) {
        errorMsg += `\n  Likely Cause: Cloudflare browser challenge (bot detection)`;
      } else if (text.includes("rate limit") || text.includes("Rate limit")) {
        errorMsg += `\n  Likely Cause: Rate limiting`;
      } else if (text.includes("Access denied") || text.includes("403")) {
        errorMsg += `\n  Likely Cause: Access denied / Forbidden`;
      }

      // Include more of the body for HTML pages
      errorMsg += `\n  Body Preview (first 500 chars):\n${text.substring(0, 500)}`;
    } else {
      // For non-HTML non-JSON, show the full response (likely an error message)
      errorMsg += `\n  Body: ${text.substring(0, 1000)}`;
    }

    throw new Error(errorMsg);
  }

  return response.json();
}
