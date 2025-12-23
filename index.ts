/**
 * Venice API Caching Test Suite v2.0
 */

const VENICE_API_URL = "https://api.venice.ai/api/v1";
const VENICE_API_KEY = process.env.VENICE_API_KEY || process.env.API_KEY_VENICE;

const CONFIG = {
  runBasicTest: true,
  runPromptSizeTest: true,
  runPartialCacheTest: true,
  runPersistenceTest: true,
  runTTLTest: false,
  maxModels: 0,
  delayBetweenModels: 1000,
};

const PROMPTS: Record<string, string> = {
  small: "You are a helpful assistant. Be concise.",
  medium: "You are an expert software engineer with knowledge of TypeScript, JavaScript, React, Vue, Angular, Node.js, Bun, Python, and databases. You write clean, maintainable code following best practices.",
  large: "You are an expert software engineer with deep knowledge of TypeScript, JavaScript, React, Vue, Angular, Node.js, Bun, Python, Rust, databases, cloud architecture, DevOps, security, and performance optimization. You write clean, maintainable, well-documented code with proper error handling.",
  xlarge: "You are an expert software engineer and system architect with comprehensive knowledge. Languages: TypeScript, JavaScript, Python, Rust, Go, Java, Kotlin. Frontend: React, Vue, Angular, Svelte. Backend: Node.js, Bun, Django, FastAPI, Spring Boot, GraphQL, gRPC. Databases: PostgreSQL, MySQL, MongoDB, Redis, Cassandra, DynamoDB, Elasticsearch. Cloud: AWS, GCP, Azure, Terraform, Kubernetes. DevOps: CI/CD, Docker, monitoring, logging, tracing. Security: OWASP, OAuth2, encryption. You write clean, maintainable code following SOLID principles with comprehensive error handling and testing."
};

interface UsageInfo { promptTokens: number; cachedTokens: number; completionTokens: number; }
interface TestResult { testName: string; model: string; success: boolean; cachingWorks: boolean; cacheHitRate: number | null; details: Record<string, any>; error?: string; }
interface ModelResults { model: string; modelName: string; tests: TestResult[]; overallCachingSupport: boolean; bestCacheRate: number; }

async function fetchModels() {
  console.log("\n📡 Fetching models from Venice API...");
  const response = await fetch(`${VENICE_API_URL}/models`, { headers: { "Authorization": `Bearer ${VENICE_API_KEY}` } });
  if (!response.ok) throw new Error(`Failed: ${response.status}`);
  return (await response.json()).data || [];
}

function extractUsage(usage: any): UsageInfo {
  return {
    promptTokens: usage?.prompt_tokens ?? 0,
    cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? usage?.cached_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
  };
}

async function sendRequest(modelId: string, systemPrompt: string, userMessage: string) {
  try {
    const response = await fetch(`${VENICE_API_URL}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${VENICE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt, cache_control: { type: "ephemeral" } },
          { role: "user", content: userMessage },
        ],
        max_tokens: 50,
        venice_parameters: { include_venice_system_prompt: false },
      }),
    });
    if (!response.ok) return { usage: { promptTokens: 0, cachedTokens: 0, completionTokens: 0 }, error: `${response.status}` };
    return { usage: extractUsage((await response.json()).usage) };
  } catch (e) {
    return { usage: { promptTokens: 0, cachedTokens: 0, completionTokens: 0 }, error: String(e) };
  }
}

async function testBasicCaching(modelId: string): Promise<TestResult> {
  const result: TestResult = { testName: "basic", model: modelId, success: false, cachingWorks: false, cacheHitRate: null, details: {} };
  const req1 = await sendRequest(modelId, PROMPTS.large, "Say hello.");
  if (req1.error) { result.error = req1.error; return result; }
  result.details.firstRequest = req1.usage;
  await Bun.sleep(500);
  const req2 = await sendRequest(modelId, PROMPTS.large, "Say hello.");
  if (req2.error) { result.error = req2.error; return result; }
  result.details.secondRequest = req2.usage;
  result.success = true;
  result.cachingWorks = req2.usage.cachedTokens > 0;
  result.cacheHitRate = req2.usage.promptTokens > 0 ? (req2.usage.cachedTokens / req2.usage.promptTokens) * 100 : 0;
  return result;
}

async function testPromptSizes(modelId: string): Promise<TestResult> {
  const result: TestResult = { testName: "prompt_sizes", model: modelId, success: false, cachingWorks: false, cacheHitRate: null, details: { sizes: {} } };
  const sizes = ["small", "medium", "large", "xlarge"];
  const cacheRates: number[] = [];
  for (const size of sizes) {
    const req1 = await sendRequest(modelId, PROMPTS[size], "Hi.");
    if (req1.error) continue;
    await Bun.sleep(300);
    const req2 = await sendRequest(modelId, PROMPTS[size], "Hi.");
    if (req2.error) continue;
    const rate = req2.usage.promptTokens > 0 ? (req2.usage.cachedTokens / req2.usage.promptTokens) * 100 : 0;
    (result.details.sizes as any)[size] = { tokens: req2.usage.promptTokens, cached: req2.usage.cachedTokens, rate: rate.toFixed(1) + "%" };
    if (req2.usage.cachedTokens > 0) result.cachingWorks = true;
    cacheRates.push(rate);
  }
  result.success = cacheRates.length > 0;
  result.cacheHitRate = cacheRates.length > 0 ? cacheRates.reduce((a, b) => a + b, 0) / cacheRates.length : null;
  return result;
}

async function testPartialCache(modelId: string): Promise<TestResult> {
  const result: TestResult = { testName: "partial_cache", model: modelId, success: false, cachingWorks: false, cacheHitRate: null, details: {} };
  const req1 = await sendRequest(modelId, PROMPTS.large, "What is 2+2?");
  if (req1.error) { result.error = req1.error; return result; }
  result.details.firstRequest = req1.usage;
  await Bun.sleep(500);
  const req2 = await sendRequest(modelId, PROMPTS.large, "What is 3+3?");
  if (req2.error) { result.error = req2.error; return result; }
  result.details.secondRequest = req2.usage;
  result.success = true;
  result.cachingWorks = req2.usage.cachedTokens > 0;
  result.cacheHitRate = req2.usage.promptTokens > 0 ? (req2.usage.cachedTokens / req2.usage.promptTokens) * 100 : 0;
  result.details.note = "Different user messages - tests system prompt caching";
  return result;
}

async function testPersistence(modelId: string): Promise<TestResult> {
  const result: TestResult = { testName: "persistence", model: modelId, success: false, cachingWorks: false, cacheHitRate: null, details: { requests: [] } };
  for (let i = 0; i < 5; i++) {
    const req = await sendRequest(modelId, PROMPTS.large, "Count.");
    if (req.error) { result.error = req.error; return result; }
    (result.details.requests as any[]).push({ attempt: i + 1, ...req.usage });
    await Bun.sleep(300);
  }
  const last = result.details.requests[4] as any;
  result.success = true;
  result.cachingWorks = last.cachedTokens > 0;
  result.cacheHitRate = last.promptTokens > 0 ? (last.cachedTokens / last.promptTokens) * 100 : 0;
  return result;
}

async function testTTL(modelId: string): Promise<TestResult> {
  const result: TestResult = { testName: "ttl", model: modelId, success: false, cachingWorks: false, cacheHitRate: null, details: { delays: {} } };
  const delays = [1, 5, 10, 30];
  for (const delay of delays) {
    const req1 = await sendRequest(modelId, PROMPTS.medium, "Test.");
    if (req1.error) continue;
    console.log(`    Waiting ${delay}s...`);
    await Bun.sleep(delay * 1000);
    const req2 = await sendRequest(modelId, PROMPTS.medium, "Test.");
    if (req2.error) continue;
    const rate = req2.usage.promptTokens > 0 ? (req2.usage.cachedTokens / req2.usage.promptTokens) * 100 : 0;
    (result.details.delays as any)[`${delay}s`] = { cached: req2.usage.cachedTokens, rate: rate.toFixed(1) + "%" };
    if (req2.usage.cachedTokens > 0) result.cachingWorks = true;
  }
  result.success = true;
  return result;
}

async function testModel(model: any): Promise<ModelResults> {
  const results: ModelResults = { model: model.id, modelName: model.model_spec?.name || model.id, tests: [], overallCachingSupport: false, bestCacheRate: 0 };
  console.log(`\n🧪 Testing: ${model.id}`);

  if (CONFIG.runBasicTest) {
    console.log("  📝 Basic caching test...");
    const r = await testBasicCaching(model.id);
    results.tests.push(r);
    console.log(`    ${r.cachingWorks ? "✅" : "❌"} ${r.cacheHitRate?.toFixed(1) ?? 0}% cache hit`);
  }

  if (CONFIG.runPromptSizeTest) {
    console.log("  📏 Prompt size test...");
    const r = await testPromptSizes(model.id);
    results.tests.push(r);
    console.log(`    ${r.cachingWorks ? "✅" : "❌"} Avg ${r.cacheHitRate?.toFixed(1) ?? 0}% across sizes`);
  }

  if (CONFIG.runPartialCacheTest) {
    console.log("  🔀 Partial cache test...");
    const r = await testPartialCache(model.id);
    results.tests.push(r);
    console.log(`    ${r.cachingWorks ? "✅" : "❌"} ${r.cacheHitRate?.toFixed(1) ?? 0}% with different user msg`);
  }

  if (CONFIG.runPersistenceTest) {
    console.log("  🔄 Persistence test...");
    const r = await testPersistence(model.id);
    results.tests.push(r);
    console.log(`    ${r.cachingWorks ? "✅" : "❌"} ${r.cacheHitRate?.toFixed(1) ?? 0}% after 5 requests`);
  }

  if (CONFIG.runTTLTest) {
    console.log("  ⏱️ TTL test...");
    const r = await testTTL(model.id);
    results.tests.push(r);
    console.log(`    ${r.cachingWorks ? "✅" : "❌"} Cache persists: ${r.cachingWorks}`);
  }

  results.overallCachingSupport = results.tests.some(t => t.cachingWorks);
  results.bestCacheRate = Math.max(...results.tests.map(t => t.cacheHitRate ?? 0));
  return results;
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🔬 VENICE CACHING TEST SUITE v2.0");
  console.log("=".repeat(80));

  if (!VENICE_API_KEY) { console.error("❌ Set VENICE_API_KEY env var"); process.exit(1); }
  console.log(`🔑 API Key: ${VENICE_API_KEY.slice(0, 8)}...${VENICE_API_KEY.slice(-4)}`);

  const allModels = await fetchModels();
  const textModels = allModels.filter((m: any) => m.type === "text");
  const models = CONFIG.maxModels > 0 ? textModels.slice(0, CONFIG.maxModels) : textModels;
  
  console.log(`\n📋 Testing ${models.length} text models`);
  console.log(`📊 Tests: basic, sizes, partial, persistence${CONFIG.runTTLTest ? ", ttl" : ""}`);

  const allResults: ModelResults[] = [];
  for (const model of models) {
    const result = await testModel(model);
    allResults.push(result);
    await Bun.sleep(CONFIG.delayBetweenModels);
  }

  console.log("\n" + "=".repeat(80));
  console.log("📊 RESULTS SUMMARY");
  console.log("=".repeat(80));

  const withCaching = allResults.filter(r => r.overallCachingSupport);
  const withoutCaching = allResults.filter(r => !r.overallCachingSupport);

  console.log(`\n✅ Models WITH caching (${withCaching.length}):`);
  withCaching.sort((a, b) => b.bestCacheRate - a.bestCacheRate);
  for (const r of withCaching) console.log(`  - ${r.model} (${r.modelName}) - ${r.bestCacheRate.toFixed(1)}% best`);

  console.log(`\n❌ Models WITHOUT caching (${withoutCaching.length}):`);
  for (const r of withoutCaching) console.log(`  - ${r.model} (${r.modelName})`);

  console.log("\n" + "-".repeat(100));
  console.log("Model                          | Basic    | Sizes    | Partial  | Persist  | Overall");
  console.log("-".repeat(100));
  for (const r of allResults) {
    const basic = r.tests.find(t => t.testName === "basic");
    const sizes = r.tests.find(t => t.testName === "prompt_sizes");
    const partial = r.tests.find(t => t.testName === "partial_cache");
    const persist = r.tests.find(t => t.testName === "persistence");
    const fmt = (t: TestResult | undefined) => t ? (t.cachingWorks ? `${t.cacheHitRate?.toFixed(0)}%`.padStart(5) + " ✅" : "  0% ❌") : "  N/A  ";
    console.log(`${r.model.padEnd(30)} | ${fmt(basic)} | ${fmt(sizes)} | ${fmt(partial)} | ${fmt(persist)} | ${r.overallCachingSupport ? "✅ YES" : "❌ NO"}`);
  }

  const date = new Date().toISOString().split("T")[0];
  const filename = `./results-${date}.json`;
  await Bun.write(filename, JSON.stringify({ date, config: CONFIG, models: allResults }, null, 2));
  console.log(`\n💾 Results saved to: ${filename}`);
  console.log(`\n📈 FINAL: ${withCaching.length}/${allResults.length} models support caching`);
}

main().catch(console.error);
