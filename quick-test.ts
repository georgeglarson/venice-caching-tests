/**
 * Quick Venice Caching Test - tests only known caching models
 */
const VENICE_API_URL = "https://api.venice.ai/api/v1";
const VENICE_API_KEY = process.env.VENICE_API_KEY || "";

const CACHING_MODELS = [
  "grok-41-fast",
  "deepseek-v3.2",
  "kimi-k2-thinking",
  "zai-org-glm-4.6",
  "zai-org-glm-4.6v"
];

const PROMPTS = {
  small: "You are helpful.",
  medium: "You are an expert software engineer with TypeScript, Python, databases, cloud.",
  large: "You are an expert software engineer with deep knowledge of TypeScript, JavaScript, React, Vue, Node.js, Bun, Python, Rust, databases, cloud, DevOps, security. You write clean code.",
};

async function sendRequest(modelId: string, systemPrompt: string, userMessage: string) {
  const response = await fetch(`${VENICE_API_URL}/chat/completions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${VENICE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: "system", content: systemPrompt, cache_control: { type: "ephemeral" } },
        { role: "user", content: userMessage },
      ],
      max_tokens: 30,
      venice_parameters: { include_venice_system_prompt: false },
    }),
  });
  const json = await response.json();
  const usage = json.usage || {};
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens ?? 0,
  };
}

async function testModel(modelId: string, size: string) {
  const req1 = await sendRequest(modelId, PROMPTS[size as keyof typeof PROMPTS], "Hi.");
  await Bun.sleep(500);
  const req2 = await sendRequest(modelId, PROMPTS[size as keyof typeof PROMPTS], "Hi.");
  const rate = req2.promptTokens > 0 ? (req2.cachedTokens / req2.promptTokens * 100).toFixed(1) : "0.0";
  return { size, cached: req2.cachedTokens, total: req2.promptTokens, rate };
}

async function main() {
  console.log("\n🔬 QUICK VENICE CACHING TEST");
  console.log("=".repeat(60));
  
  for (const model of CACHING_MODELS) {
    console.log(`\n🧪 ${model}`);
    for (const size of ["small", "medium", "large"]) {
      const r = await testModel(model, size);
      const icon = r.cached > 0 ? "✅" : "❌";
      console.log(`  ${icon} ${size.padEnd(8)}: ${r.rate}% (${r.cached}/${r.total} tokens)`);
    }
  }
  console.log("\n✅ Done!");
}

main();
