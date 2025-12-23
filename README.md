# Venice Caching Test Suite

Tests which Venice.ai models actually support prompt caching.

## What it does

1. Fetches all available models from Venice API
2. Filters for text/coding models
3. For each model:
   - Sends a request WITH `cache_control` hints
   - Sends the SAME request again
   - Checks if `cached_tokens` appear in the response usage
4. Reports which models support caching

## Setup

```bash
# Set your Venice API key
export VENICE_API_KEY="your-key-here"

# Run the tests
bun run index.ts
```

## Output

- Console shows real-time progress and summary table
- Results saved to `results-YYYY-MM-DD.json`

## Understanding Results

- **Caching WORKS**: Second request shows `cached_tokens > 0`
- **Caching NOT DETECTED**: No cached tokens in response
- **Cache Hit Rate**: Percentage of prompt tokens that were cached

## Notes

- Caching may work for models that natively support it (Claude, etc.)
- Venice may implement server-side caching (vLLM prefix caching) for other models
- Run this periodically as Venice enables caching for more models
