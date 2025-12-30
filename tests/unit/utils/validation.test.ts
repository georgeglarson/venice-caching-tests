/**
 * Tests for validation utility functions
 */

import { describe, test, expect } from "bun:test";
import { clampInt, safeJsonParse } from "../../../src/utils/validation.ts";

describe("clampInt", () => {
  test("should parse valid integer string correctly", () => {
    expect(clampInt("50", 10, 1, 100)).toBe(50);
    expect(clampInt("42", 0, 0, 100)).toBe(42);
    expect(clampInt("1", 5, 1, 10)).toBe(1);
  });

  test("should return default value for undefined input", () => {
    expect(clampInt(undefined, 10, 1, 100)).toBe(10);
    expect(clampInt(undefined, 50, 0, 100)).toBe(50);
    expect(clampInt(undefined, 25, 1, 50)).toBe(25);
  });

  test("should return default value for invalid string (NaN)", () => {
    expect(clampInt("invalid", 10, 1, 100)).toBe(10);
    expect(clampInt("abc", 20, 0, 50)).toBe(20);
    expect(clampInt("", 15, 1, 30)).toBe(15);
    expect(clampInt("12.5abc", 10, 1, 100)).toBe(12); // parseInt stops at non-digit
  });

  test("should clamp value to min when below minimum", () => {
    expect(clampInt("0", 10, 1, 100)).toBe(1);
    expect(clampInt("-5", 10, 0, 100)).toBe(0);
    expect(clampInt("-100", 50, 10, 100)).toBe(10);
  });

  test("should clamp value to max when above maximum", () => {
    expect(clampInt("150", 10, 1, 100)).toBe(100);
    expect(clampInt("1000", 50, 0, 100)).toBe(100);
    expect(clampInt("999", 10, 1, 50)).toBe(50);
  });

  test("should return value within bounds unchanged", () => {
    expect(clampInt("50", 10, 1, 100)).toBe(50);
    expect(clampInt("1", 10, 1, 100)).toBe(1); // At minimum
    expect(clampInt("100", 10, 1, 100)).toBe(100); // At maximum
    expect(clampInt("75", 10, 0, 100)).toBe(75);
  });

  test("should handle edge cases with equal min and max", () => {
    expect(clampInt("50", 10, 50, 50)).toBe(50);
    expect(clampInt("100", 10, 50, 50)).toBe(50);
    expect(clampInt("1", 10, 50, 50)).toBe(50);
  });

  test("should handle negative ranges", () => {
    expect(clampInt("-50", 0, -100, -10)).toBe(-50);
    expect(clampInt("0", -50, -100, -10)).toBe(-10);
    expect(clampInt("-200", -50, -100, -10)).toBe(-100);
  });
});

describe("safeJsonParse", () => {
  test("should parse valid JSON string correctly", () => {
    expect(safeJsonParse('{"key": "value"}')).toEqual({ key: "value" });
    expect(safeJsonParse("[1, 2, 3]")).toEqual([1, 2, 3]);
    expect(safeJsonParse('"hello"')).toBe("hello");
    expect(safeJsonParse("123")).toBe(123);
    expect(safeJsonParse("true")).toBe(true);
    expect(safeJsonParse("null")).toBe(null);
  });

  test("should return null for null input", () => {
    expect(safeJsonParse(null)).toBe(null);
  });

  test("should return null for empty string", () => {
    expect(safeJsonParse("")).toBe(null);
  });

  test("should return error object with _parseError: true for invalid JSON", () => {
    const result = safeJsonParse("not valid json") as { _parseError: boolean; _raw: string };

    expect(result._parseError).toBe(true);
    expect(result._raw).toBe("not valid json");
  });

  test("should include truncated raw string (max 100 chars) in error object", () => {
    const longString = "x".repeat(200);
    const result = safeJsonParse(longString) as { _parseError: boolean; _raw: string };

    expect(result._parseError).toBe(true);
    expect(result._raw.length).toBe(100);
    expect(result._raw).toBe("x".repeat(100));
  });

  test("should handle various invalid JSON formats", () => {
    // Missing quotes around keys
    const result1 = safeJsonParse("{key: 'value'}") as { _parseError: boolean };
    expect(result1._parseError).toBe(true);

    // Trailing comma
    const result2 = safeJsonParse('{"key": "value",}') as { _parseError: boolean };
    expect(result2._parseError).toBe(true);

    // Single quotes instead of double
    const result3 = safeJsonParse("{'key': 'value'}") as { _parseError: boolean };
    expect(result3._parseError).toBe(true);

    // Undefined (not valid JSON)
    const result4 = safeJsonParse("undefined") as { _parseError: boolean };
    expect(result4._parseError).toBe(true);
  });

  test("should handle complex nested JSON", () => {
    const complexJson = JSON.stringify({
      users: [
        { id: 1, name: "Alice", roles: ["admin", "user"] },
        { id: 2, name: "Bob", roles: ["user"] },
      ],
      metadata: {
        count: 2,
        page: 1,
        nested: {
          deep: {
            value: true,
          },
        },
      },
    });

    const result = safeJsonParse(complexJson);
    expect(result).toEqual({
      users: [
        { id: 1, name: "Alice", roles: ["admin", "user"] },
        { id: 2, name: "Bob", roles: ["user"] },
      ],
      metadata: {
        count: 2,
        page: 1,
        nested: {
          deep: {
            value: true,
          },
        },
      },
    });
  });

  test("should handle JSON with unicode characters", () => {
    const unicodeJson = '{"message": "Hello, \u4e16\u754c!", "emoji": "\ud83d\ude00"}';
    const result = safeJsonParse(unicodeJson);

    expect(result).toEqual({
      message: "Hello, \u4e16\u754c!",
      emoji: "\ud83d\ude00",
    });
  });

  test("should handle JSON with escaped characters", () => {
    const escapedJson = '{"path": "C:\\\\Users\\\\test", "quote": "He said \\"hello\\""}';
    const result = safeJsonParse(escapedJson);

    expect(result).toEqual({
      path: "C:\\Users\\test",
      quote: 'He said "hello"',
    });
  });
});
