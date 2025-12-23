# Venice API Caching Test Suite

Test suite to evaluate prompt caching support across Venice.ai models.

## ⚠️ Key Finding: Caching is Inconsistent

Testing reveals that Venice's caching behavior is **highly inconsistent** between requests:

- Same model + same prompt can show 80%+ cache hit in one run, 0% in the next
- Results vary significantly even with seconds between identical tests
- This makes caching unreliable for cost optimization

## Models Tested

| Model | Caching Observed | Reliability |
|-------|-----------------|-------------|
| grok-41-fast | ✅ Yes | ⚠️ Inconsistent (0-99%) |
| deepseek-v3.2 | ✅ Sometimes | ⚠️ Inconsistent |
| zai-org-glm-4.6 | ✅ Sometimes | ⚠️ Inconsistent |
| zai-org-glm-4.6v | ✅ Yes | Better consistency |
| kimi-k2-thinking | ⚠️ Rare | Mostly 0% |
| llama-* | ❌ No | N/A |
| qwen-* | ❌ No | N/A |
| claude-* | ❌ No | N/A |
| gemini-* | ❌ No | N/A |

## Usage

```bash
# Install
bun install

# Set API key
export VENICE_API_KEY="your-key"

# Run full test suite (all models, slow)
bun run test

# Run quick test (known caching models only)
bun run quick-test.ts
```

## Test Types

1. **Basic** - Send identical requests, check for cached_tokens
2. **Prompt Sizes** - Test small/medium/large/xlarge prompts
3. **Partial Cache** - Same system prompt, different user messages
4. **Persistence** - Multiple sequential requests
5. **TTL** - Cache duration over time delays

## Conclusion

Venice caching exists for some models but is not reliable enough for production cost optimization. The `cached_tokens` field appears in responses intermittently, suggesting:

1. Caching may be load-balanced across servers without shared cache
2. Cache eviction happens very quickly
3. Or caching is still in development/testing

## License

MIT
