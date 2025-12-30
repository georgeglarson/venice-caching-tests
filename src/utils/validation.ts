/**
 * Input validation utility functions
 * Provides shared validation and parsing helpers for user input.
 */

/**
 * Parses a string to integer with bounds clamping and default fallback.
 * Returns the default value if parsing fails or produces NaN.
 *
 * @param value - The string value to parse (can be undefined)
 * @param defaultVal - Default value if parsing fails
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns The parsed and clamped integer value
 * @example
 * clampInt("50", 10, 1, 100);  // 50
 * clampInt("150", 10, 1, 100); // 100 (clamped to max)
 * clampInt(undefined, 10, 1, 100); // 10 (default)
 * clampInt("invalid", 10, 1, 100); // 10 (default on parse failure)
 */
export function clampInt(
  value: string | undefined,
  defaultVal: number,
  min: number,
  max: number
): number {
  const parsed = parseInt(value || String(defaultVal));
  if (isNaN(parsed)) return defaultVal;
  return Math.min(Math.max(parsed, min), max);
}

/**
 * Safely parses a JSON string with error handling.
 * Returns null for null/empty input, and an error object on parse failure.
 *
 * @param json - The JSON string to parse (can be null)
 * @returns Parsed JSON value, null, or error object with _parseError flag
 * @example
 * safeJsonParse('{"key": "value"}'); // { key: "value" }
 * safeJsonParse(null); // null
 * safeJsonParse('invalid json'); // { _parseError: true, _raw: "invalid json" }
 */
export function safeJsonParse(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return { _parseError: true, _raw: json.slice(0, 100) };
  }
}
