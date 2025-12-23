/**
 * Venice API Caching Test Suite
 * 
 * Tests which Venice models actually support prompt caching by:
 * 1. Fetching available models from Venice API
 * 2. Sending a request with cache_control hints
 * 3. Sending the SAME request again
 * 4. Checking if cached_tokens appear in the response
 */

const VENICE_API_URL = "https://api.venice.ai/api/v1";
const VENICE_API_KEY = process.env.VENICE_API_KEY || process.env.API_KEY_VENICE;

interface VeniceModel {
  id: string;
  model_spec: {
    name: string;
    capabilities: {
      optimizedForCode?: boolean;
      supportsFunctionCalling?: boolean;
    };
  };
  type: string;
}

interface CacheTestResult {
  model: string;
  modelName: string;
  success: boolean;
  firstRequest: {
    promptTokens: number;
    cachedTokens: number;
    completionTokens: number;
  } | null;
  secondRequest: {
    promptTokens: number;
    cachedTokens: number;
    completionTokens: number;
  } | null;
  cachingWorks: boolean;
  cacheHitRate: number | null;
  error?: string;
}

async function fetchModels(): Promise<VeniceModel[]> {
  console.log("📡 Fetching models from Venice API...\n");
  
  const response = await fetch(`${VENICE_API_URL}/models`, {
    headers: {
      "Authorization": `Bearer ${VENICE_API_KEY}`,
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.data || [];
}

function extractCachedTokens(usage: any): number {
  // Try different locations where cached_tokens might appear
  return (
    usage?.prompt_tokens_details?.cached_tokens ??
    usage?.cached_tokens ??
    0
  );
}

async function testModelCaching(modelId: string, modelName: string): Promise<CacheTestResult> {
  const result: CacheTestResult = {
    model: modelId,
    modelName: modelName,
    success: false,
    firstRequest: null,
    secondRequest: null,
    cachingWorks: false,
    cacheHitRate: null,
  };
  
  // Large system prompt to make caching worthwhile
  const systemPrompt = `You are an expert software engineer with deep knowledge of:
- TypeScript and JavaScript
- React, Vue, and Angular frameworks  
- Node.js and Bun runtimes
- Python and its ecosystem
- Rust and systems programming
- Database design (SQL and NoSQL)
- Cloud architecture (AWS, GCP, Azure)
- DevOps and CI/CD pipelines
- Security best practices
- Performance optimization

You write clean, maintainable, well-documented code.
You follow best practices and design patterns.
You consider edge cases and error handling.
You optimize for readability and performance.

When asked coding questions, provide complete, working examples.
Explain your reasoning and any trade-offs in your solutions.
`;

  const userMessage = "Write a simple hello world in TypeScript. Be very brief.";

  const requestBody = {
    model: modelId,
    messages: [
      {
        role: "system",
        content: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
      {
        role: "user", 
        content: userMessage,
      },
    ],
    max_tokens: 100,
    venice_parameters: {
      include_venice_system_prompt: false,
    },
  };

  try {
    // First request - should NOT have cache hit
    console.log(`  📤 First request...`);
    const response1 = await fetch(`${VENICE_API_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${VENICE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response1.ok) {
      const errorText = await response1.text();
      result.error = `First request failed: ${response1.status} - ${errorText}`;
      return result;
    }

    const data1 = await response1.json();
    const usage1 = data1.usage;
    
    result.firstRequest = {
      promptTokens: usage1?.prompt_tokens ?? 0,
      cachedTokens: extractCachedTokens(usage1),
      completionTokens: usage1?.completion_tokens ?? 0,
    };

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 500));

    // Second request - SHOULD have cache hit if caching works
    console.log(`  📤 Second request (checking for cache hit)...`);
    const response2 = await fetch(`${VENICE_API_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${VENICE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response2.ok) {
      const errorText = await response2.text();
      result.error = `Second request failed: ${response2.status} - ${errorText}`;
      return result;
    }

    const data2 = await response2.json();
    const usage2 = data2.usage;
    
    result.secondRequest = {
      promptTokens: usage2?.prompt_tokens ?? 0,
      cachedTokens: extractCachedTokens(usage2),
      completionTokens: usage2?.completion_tokens ?? 0,
    };

    result.success = true;
    
    // Determine if caching actually works
    const secondCachedTokens = result.secondRequest.cachedTokens;
    result.cachingWorks = secondCachedTokens > 0;
    
    if (result.secondRequest.promptTokens > 0) {
      result.cacheHitRate = (secondCachedTokens / result.secondRequest.promptTokens) * 100;
    }

  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

function printResults(results: CacheTestResult[]) {
  console.log("\n" + "=".repeat(80));
  console.log("📊 VENICE CACHING TEST RESULTS");
  console.log("=".repeat(80) + "\n");

  // Summary table
  console.log("Model                          | Caching | Cache Hit | 1st Cached | 2nd Cached");
  console.log("-".repeat(80));

  for (const r of results) {
    const modelCol = r.model.padEnd(30).slice(0, 30);
    const cachingCol = r.cachingWorks ? "✅ YES " : "❌ NO  ";
    const hitRateCol = r.cacheHitRate !== null 
      ? `${r.cacheHitRate.toFixed(1)}%`.padEnd(9)
      : "N/A      ";
    const first = r.firstRequest?.cachedTokens?.toString() ?? "err";
    const second = r.secondRequest?.cachedTokens?.toString() ?? "err";
    
    console.log(`${modelCol} | ${cachingCol} | ${hitRateCol} | ${first.padEnd(10)} | ${second}`);
    
    if (r.error) {
      console.log(`  ⚠️  Error: ${r.error.slice(0, 60)}...`);
    }
  }

  // Summary stats
  const working = results.filter(r => r.cachingWorks).length;
  const tested = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log("\n" + "=".repeat(80));
  console.log(`📈 SUMMARY: ${working}/${tested} models support caching (${failed} failed to test)`);
  console.log("=".repeat(80));
  
  if (working > 0) {
    console.log("\n✅ Models WITH caching:");
    for (const r of results.filter(r => r.cachingWorks)) {
      console.log(`   - ${r.model} (${r.modelName}) - ${r.cacheHitRate?.toFixed(1)}% cache hit`);
    }
  }
  
  if (tested - working > 0) {
    console.log("\n❌ Models WITHOUT caching:");
    for (const r of results.filter(r => r.success && !r.cachingWorks)) {
      console.log(`   - ${r.model} (${r.modelName})`);
    }
  }
  
  if (failed > 0) {
    console.log("\n⚠️  Models that FAILED to test:");
    for (const r of results.filter(r => !r.success)) {
      console.log(`   - ${r.model}: ${r.error?.slice(0, 50)}...`);
    }
  }
}

async function main() {
  console.log("\n🔬 VENICE CACHING TEST SUITE\n");
  
  if (!VENICE_API_KEY) {
    console.error("❌ Error: VENICE_API_KEY environment variable not set");
    console.error("   Set it with: export VENICE_API_KEY=your_key_here");
    process.exit(1);
  }
  
  console.log(`🔑 Using API key: ${VENICE_API_KEY.slice(0, 8)}...${VENICE_API_KEY.slice(-4)}\n`);

  // Fetch models
  const models = await fetchModels();
  console.log(`📋 Found ${models.length} total models\n`);
  
  // Filter for text models (not image generation)
  const textModels = models.filter(m => m.type === "text");
  console.log(`🔤 ${textModels.length} text models to test:\n`);
  
  for (const m of textModels) {
    const codeFlag = m.model_spec?.capabilities?.optimizedForCode ? "[CODE]" : "";
    console.log(`   - ${m.id} (${m.model_spec?.name || 'Unknown'}) ${codeFlag}`);
  }
  console.log("");

  // Test each model
  const results: CacheTestResult[] = [];
  
  for (const model of textModels) {
    console.log(`\n🧪 Testing: ${model.id}`);
    const result = await testModelCaching(model.id, model.model_spec?.name || model.id);
    results.push(result);
    
    if (result.success) {
      const icon = result.cachingWorks ? "✅" : "❌";
      console.log(`  ${icon} Caching: ${result.cachingWorks ? "WORKS" : "NOT DETECTED"}`);
      if (result.cacheHitRate !== null) {
        console.log(`  📊 Cache hit rate: ${result.cacheHitRate.toFixed(1)}%`);
      }
    } else {
      console.log(`  ⚠️  Test failed: ${result.error}`);
    }
    
    // Small delay between models to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Print final results
  printResults(results);
  
  // Save results to JSON
  const outputFile = `./results-${new Date().toISOString().split('T')[0]}.json`;
  await Bun.write(outputFile, JSON.stringify(results, null, 2));
  console.log(`\n💾 Results saved to: ${outputFile}`);
}

main().catch(console.error);
