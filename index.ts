/**
 * Venice API Caching Test Suite v2.0
 * CLI Entry Point
 */

import {
  runTests,
  fetchModels,
  formatResultsTable,
  getApiKey,
  DEFAULT_CONFIG,
  type TestConfig,
  type ModelResults,
} from "./src/core/index.ts";

// Merge with DEFAULT_CONFIG to ensure consistency with scheduler settings
// (including isolation settings like injectTestRunId, isolationDelay)
const CONFIG: TestConfig = {
  ...DEFAULT_CONFIG,
  // Override any CLI-specific settings here if needed
};

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🔬 VENICE CACHING TEST SUITE v2.0");
  console.log("=".repeat(80));

  let apiKey: string;
  try {
    apiKey = getApiKey();
  } catch {
    console.error("❌ Set VENICE_API_KEY env var");
    process.exit(1);
  }
  console.log(`🔑 API Key: ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`);

  console.log("\n📡 Fetching models from Venice API...");
  const allModels = await fetchModels();
  const textModels = allModels.filter((m) => m.type === "text");
  const modelCount = CONFIG.maxModels > 0 ? Math.min(CONFIG.maxModels, textModels.length) : textModels.length;

  console.log(`\n📋 Testing ${modelCount} text models`);
  console.log(`📊 Tests: basic, sizes, partial, persistence${CONFIG.runTTLTest ? ", ttl" : ""}`);

  const allResults: ModelResults[] = [];

  const results = await runTests({
    config: CONFIG,
    onProgress: (event) => {
      if (event.status === "started") {
        if (event.testName === "basic" && event.progress.completed === 0 ||
            event.progress.completed !== allResults.length) {
          console.log(`\n🧪 Testing: ${event.modelId}`);
        }
        const testLabels: Record<string, string> = {
          basic: "📝 Basic caching test...",
          prompt_sizes: "📏 Prompt size test...",
          partial_cache: "🔀 Partial cache test...",
          persistence: "🔄 Persistence test...",
          ttl: "⏱️ TTL test...",
        };
        console.log(`  ${testLabels[event.testName] || event.testName}`);
      } else if (event.status === "completed" && event.result) {
        const r = event.result;
        const resultLabels: Record<string, string> = {
          basic: `${r.cachingWorks ? "✅" : "❌"} ${r.cacheHitRate?.toFixed(1) ?? 0}% cache hit`,
          prompt_sizes: `${r.cachingWorks ? "✅" : "❌"} Avg ${r.cacheHitRate?.toFixed(1) ?? 0}% across sizes`,
          partial_cache: `${r.cachingWorks ? "✅" : "❌"} ${r.cacheHitRate?.toFixed(1) ?? 0}% with different user msg`,
          persistence: `${r.cachingWorks ? "✅" : "❌"} ${r.cacheHitRate?.toFixed(1) ?? 0}% cache persistence`,
          ttl: `${r.cachingWorks ? "✅" : "❌"} Cache persists: ${r.cachingWorks}`,
        };
        console.log(`    ${resultLabels[event.testName] || `Done: ${r.cacheHitRate?.toFixed(1) ?? 0}%`}`);
      }
    },
  });

  allResults.push(...results);

  console.log("\n" + "=".repeat(80));
  console.log("📊 RESULTS SUMMARY");
  console.log("=".repeat(80));

  const withCaching = allResults.filter((r) => r.overallCachingSupport);
  const withoutCaching = allResults.filter((r) => !r.overallCachingSupport);

  console.log(`\n✅ Models WITH caching (${withCaching.length}):`);
  withCaching.sort((a, b) => b.bestCacheRate - a.bestCacheRate);
  for (const r of withCaching) {
    console.log(`  - ${r.model} (${r.modelName}) - ${r.bestCacheRate.toFixed(1)}% best`);
  }

  console.log(`\n❌ Models WITHOUT caching (${withoutCaching.length}):`);
  for (const r of withoutCaching) {
    console.log(`  - ${r.model} (${r.modelName})`);
  }

  console.log("\n" + formatResultsTable(allResults));

  const date = new Date().toISOString().split("T")[0];
  const filename = `./results-${date}.json`;
  await Bun.write(filename, JSON.stringify({ date, config: CONFIG, models: allResults }, null, 2));
  console.log(`\n💾 Results saved to: ${filename}`);
  console.log(`\n📈 FINAL: ${withCaching.length}/${allResults.length} models support caching`);
}

main().catch(console.error);
