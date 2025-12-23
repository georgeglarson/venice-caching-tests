# Venice Caching Test Suite v2.0

Comprehensive test suite to discover which Venice.ai models actually support prompt caching.

## Test Variations

This suite runs **5 different tests** per model:

| Test | Description | What it reveals |
|------|-------------|----------------|
| **Basic** | Send identical requests twice | Does caching work at all? |
| **Prompt Sizes** | Test small/medium/large/xlarge prompts | Is there a minimum prompt size for caching? |
| **Partial Cache** | Same system prompt, different user message | Does system prompt cache independently? |
| **Persistence** | 5 sequential identical requests | Does cache persist across requests? |
| **TTL** | Delays of 1s, 5s, 10s, 30s between requests | How long does cache last? |

## Quick Start

```bash
git clone https://github.com/georgeglarson/venice-caching-tests.git
cd venice-caching-tests
export VENICE_API_KEY="your-api-key"
bun run test
```

## Configuration

Edit `CONFIG` in `index.ts` to customize:

```typescript
const CONFIG = {
  runBasicTest: true,        // Identical request test
  runPromptSizeTest: true,   // Small/medium/large/xlarge
  runPartialCacheTest: true, // Different user messages
  runPersistenceTest: true,  // 5 sequential requests
  runTTLTest: false,         // Cache TTL (slower)
  maxModels: 0,              // 0 = all, or limit for quick testing
  delayBetweenModels: 1000,  // ms between models
};
```

## Latest Results (2025-12-23)

**5 out of 21 models** support caching:

| Model | Cache Hit Rate | Notes |
|-------|---------------|-------|
| grok-41-fast | 99.7% | Best overall |
| zai-org-glm-4.6v | 99.4% | GLM Vision |
| zai-org-glm-4.6 | 97.6% | GLM Text |
| deepseek-v3.2 | 82.1% | Good |
| kimi-k2-thinking | 78.0% | Moonshot |

### Models WITHOUT caching:
- All LLaMA variants (3.2-3b, 3.3-70b, hermes-3-405b)
- All Qwen variants (including qwen3-coder-480b)
- Claude Opus 4.5 (through Venice)
- Gemini 3 Pro/Flash (through Venice)
- GPT-5.2, GPT-OSS-120b
- Mistral 31-24b
- Google Gemma 3
- Venice Uncensored

## Output

Results are saved to `results-YYYY-MM-DD.json` with full details:
- Per-model test results
- Cache hit rates for each test variation
- Token counts and timing data

## Why This Matters

Prompt caching can reduce costs by 75-90% for repeated system prompts.
Knowing which models support it helps optimize API usage and costs.

## Requirements

- [Bun](https://bun.sh) runtime
- Venice API key with model access

## License

MIT
