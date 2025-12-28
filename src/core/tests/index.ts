/**
 * Venice Caching Test Suite
 *
 * This module provides tests to detect and measure prompt caching behavior
 * in Venice.ai's API. Each test sends requests with `cache_control: { type: "ephemeral" }`
 * and measures `cached_tokens` in the response to determine if caching is working.
 *
 * ## Test Types
 *
 * ### basic
 * The fundamental caching test. Sends the same request twice with a 500ms delay.
 * If caching works, the second request should show cached_tokens > 0.
 * - Requests: 2
 * - Measures: Cache hit rate on second request
 *
 * ### prompt_sizes
 * Tests caching across different system prompt sizes (small, medium, large, xlarge).
 * For each size, sends identical request twice. Helps identify if caching has
 * minimum token thresholds.
 * - Requests: 8 (2 per size)
 * - Measures: Average cache hit rate across all sizes
 *
 * ### partial_cache
 * Tests if the system prompt is cached independently of user messages.
 * Sends two requests with the SAME system prompt but DIFFERENT user messages.
 * If caching works properly, the system prompt tokens should be cached.
 * - Requests: 2
 * - Measures: Cache hit rate with varying user messages
 *
 * ### persistence
 * Tests cache durability across multiple sequential requests.
 * Sends 10 identical requests in sequence (configurable via persistenceRequests).
 * Measures if cache persists across repeated requests.
 * - Requests: 10 (default)
 * - Measures: Cache hit rate on final request
 *
 * ### ttl
 * Tests cache lifetime with varying delays between requests.
 * Sends request pairs with delays of 1s, 5s, 10s, and 30s between them.
 * Helps identify cache TTL (time-to-live) behavior.
 * - Requests: 8 (2 per delay)
 * - Measures: Average cache hit rate, identifies TTL boundaries
 *
 * ## Interpreting Results
 *
 * - **cacheHitRate**: Percentage of prompt tokens served from cache (0-100%)
 * - **cachingWorks**: True if any cached_tokens > 0 detected
 * - **cacheIsolationNote**: Warnings about potential cache pollution
 *
 * ## False Negatives
 *
 * Caching may work but not be detected due to:
 * - Cache warm-up time (first few requests may not show caching)
 * - Minimum token thresholds (very small prompts may not be cached)
 * - Server-side cache partitioning (may need more requests)
 * - Rate limiting affecting cache population
 *
 * If Venice reports caching is working but tests show 0%, try:
 * 1. Running multiple test cycles to warm the cache
 * 2. Using larger prompts (xlarge size)
 * 3. Increasing persistence test request count
 * 4. Checking for rate limit errors in results
 */

export { testBasicCaching } from "./basic.ts";
export { testPromptSizes } from "./prompt-sizes.ts";
export { testPartialCache } from "./partial-cache.ts";
export { testPersistence } from "./persistence.ts";
export { testTTL } from "./ttl.ts";
