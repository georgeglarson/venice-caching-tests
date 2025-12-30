/**
 * Quick Venice Caching Test - tests only known caching models
 */

import { sendRequest, getApiKey } from "./src/core/index.ts";

const CACHING_MODELS = [
  "grok-41-fast",
  "deepseek-v3.2",
  "kimi-k2-thinking",
  "zai-org-glm-4.6",
  "zai-org-glm-4.6v",
];

// Use smaller prompts for quick test
const QUICK_PROMPTS = {
  small: "You are helpful.",
  medium:
    "You are an expert software engineer with TypeScript, Python, databases, cloud.",
  large:
    "You are an expert software engineer with deep knowledge of TypeScript, JavaScript, React, Vue, Node.js, Bun, Python, Rust, databases, cloud, DevOps, security. You write clean code.",
};

async function testModel(modelId: string, size: keyof typeof QUICK_PROMPTS) {
  await sendRequest(modelId, QUICK_PROMPTS[size], "Hi.");
  await Bun.sleep(500);
  const req2 = await sendRequest(modelId, QUICK_PROMPTS[size], "Hi.");

  const rate =
    req2.usage.promptTokens > 0
      ? ((req2.usage.cachedTokens / req2.usage.promptTokens) * 100).toFixed(1)
      : "0.0";

  return {
    size,
    cached: req2.usage.cachedTokens,
    total: req2.usage.promptTokens,
    rate,
  };
}

async function main() {
  console.log("\n🔬 QUICK VENICE CACHING TEST");
  console.log("=".repeat(60));

  try {
    getApiKey();
  } catch {
    console.error("❌ Set VENICE_API_KEY env var");
    process.exit(1);
  }

  for (const model of CACHING_MODELS) {
    console.log(`\n🧪 ${model}`);
    for (const size of ["small", "medium", "large"] as const) {
      const r = await testModel(model, size);
      const icon = r.cached > 0 ? "✅" : "❌";
      console.log(`  ${icon} ${size.padEnd(8)}: ${r.rate}% (${r.cached}/${r.total} tokens)`);
    }
  }
  console.log("\n✅ Done!");
}

main();
