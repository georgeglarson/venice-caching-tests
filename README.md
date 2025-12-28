# Venice Caching Health Monitor

A comprehensive test suite and web dashboard to monitor Venice.ai prompt caching support across models.

## Features

- **Web Dashboard** - Real-time monitoring at `/cache/`
- **Cache Microscope** - Live test any model with reproducible curl commands
- **Historical Sparklines** - Inline trend charts for each model
- **Provider Filtering** - Filter by Anthropic, OpenAI, Zhipu, DeepSeek, etc.
- **Scheduled Tests** - Automatic 10-minute testing cycles
- **Token Usage Tracking** - Monitor token consumption and cache savings
- **Auto Data Retention** - Automatic cleanup of data older than 30 days

## Quick Start

```bash
# Install dependencies
bun install

# Set API key
export VENICE_API_KEY="your-key"

# Start the dashboard
bun run server.ts

# Open http://localhost:3000/cache/ in your browser
```

## Dashboard Features

### Health Overview
- Overall cache health status badge
- Quick stats: last run, models tested, caching models, avg rate
- Auto-refresh with 60s countdown

### Model Table
- Sortable columns (click headers)
- Provider badges with color coding
- Inline sparkline trends (last 10 tests)
- Click-to-copy model IDs
- Filter by provider or caching status

### Cache Microscope
- Live test any model with real API calls
- Side-by-side model comparison
- Shows response times and cache speedup
- Raw JSON evidence for debugging
- Reproducible curl command for external testing

### Charts
- Bar chart comparing model performance
- Line chart showing cache rate trends over time

### Token Usage Stats
- Total requests, prompt tokens, cached tokens
- Cache savings percentage
- Daily token averages

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/cache/api/stats` | Dashboard overview stats |
| GET | `/cache/api/models` | All models with computed stats |
| GET | `/cache/api/sparklines` | Recent cache rates for sparklines |
| GET | `/cache/api/results` | Recent test results |
| GET | `/cache/api/history` | Historical data for charts |
| GET | `/cache/api/usage` | Token usage statistics |
| GET | `/cache/api/logs` | Server logs |
| GET | `/cache/api/health` | Health check with status |
| GET | `/cache/api/scheduler` | Scheduler status |
| POST | `/cache/api/run` | Trigger manual test run |
| GET | `/cache/api/test/:modelId` | Live test a single model |
| GET | `/cache/api/compare/:m1/:m2` | Compare two models |
| GET | `/cache/api/model/:id/history` | Model test history |

## Test Types

1. **Basic** - Send identical requests, check for cached_tokens
2. **Prompt Sizes** - Test small/medium/large/xlarge prompts
3. **Partial Cache** - Same system prompt, different user messages
4. **Persistence** - Multiple sequential requests
5. **TTL** - Cache duration over time delays

## Project Structure

```
venice-caching-tests/
├── src/
│   ├── core/           # Test logic modules
│   │   ├── types.ts    # TypeScript interfaces
│   │   ├── config.ts   # Configuration & prompts
│   │   ├── api.ts      # Venice API client
│   │   ├── runner.ts   # Test orchestration
│   │   ├── logger.ts   # Structured logging
│   │   └── tests/      # Individual test implementations
│   ├── db/             # SQLite database layer
│   │   ├── schema.ts   # Table definitions
│   │   ├── migrations.ts # Database setup
│   │   └── repository.ts # Query functions
│   ├── server/         # Hono web server
│   │   ├── index.ts    # Server setup & static files
│   │   └── routes/     # API endpoints
│   ├── scheduler/      # Background job scheduler
│   └── dashboard/      # Frontend (HTML/CSS/JS)
│       ├── index.html  # Dashboard page
│       ├── app.js      # Dashboard logic
│       └── styles.css  # Terminal-aesthetic styling
├── data/               # SQLite database (gitignored)
└── server.ts           # Entry point
```

## Tech Stack

- **Runtime:** Bun
- **Web Framework:** Hono
- **Database:** SQLite (bun:sqlite)
- **Frontend:** Vanilla JS + Chart.js
- **Styling:** Custom terminal aesthetic

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VENICE_API_KEY` | Venice API key (required) | - |
| `PORT` | Server port | 3000 |
| `ALLOWED_ORIGINS` | CORS origins (comma-separated) | localhost |

## Key Finding: Claude Models Don't Cache

Testing reveals that **Claude models (Opus, Sonnet) do not return cached tokens** through Venice, while other models like GLM and DeepSeek show consistent caching:

| Provider | Caching Status |
|----------|----------------|
| Zhipu (GLM) | ✅ Working (78-99% hit rates) |
| DeepSeek | ✅ Working (varies) |
| Anthropic (Claude) | ❌ Not working (0% always) |
| OpenAI (GPT) | ⚠️ Inconsistent |

Use the Cache Microscope to verify this yourself with live API calls.

## License

MIT
