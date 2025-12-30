# Venice Caching Health Monitor

A comprehensive test suite and web dashboard to monitor Venice.ai prompt caching support across models.

## Features

- **Web Dashboard** - Real-time monitoring at `/cache/`
- **Cache Microscope** - Live test any model with reproducible curl commands
- **Historical Sparklines** - Inline trend charts for each model
- **Provider Filtering** - Filter by Zhipu, DeepSeek, Qwen, Mistral, xAI, Google, etc.
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

## Development Setup

### Prerequisites

- **Bun** v1.0.0 or higher ([installation guide](https://bun.sh/docs/installation))
- **Venice API Key** - Get yours at [venice.ai/api](https://venice.ai/api)
- **SQLite** - Included with Bun, no separate installation needed

### Local Development

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd venice-caching-tests
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env and add your VENICE_API_KEY
   ```

4. **Initialize database**
   ```bash
   bun run db:init
   ```

5. **Start development server**
   ```bash
   bun run server:dev
   ```
   The `--watch` flag automatically restarts on file changes.

6. **Run tests**
   ```bash
   bun test
   ```

### Development Workflow

- **Server**: `bun run server:dev` - Auto-reloads on changes
- **CLI Tests**: `bun run venice` - Run tests from command line
- **Quick Test**: `bun run venice:quick` - Test known models quickly
- **Database Migrations**: `bun run db:migrate:status` - Check migration status

### Debugging

Enable verbose API logging:
```bash
export DEBUG_API_REQUESTS=true
bun run server:dev
```

Each API request will include a unique request ID (e.g., `[API:a1b2c3d4]`) for correlation across logs.

### Project Structure

See the "Project Structure" section below for detailed directory layout.

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
| GET | `/cache/api/health` | Health check with status and metrics summary |
| GET | `/cache/api/scheduler` | Scheduler status |
| GET | `/cache/api/metrics` | Prometheus-compatible metrics endpoint |
| GET | `/cache/api/metrics?format=json` | Metrics in JSON format |
| POST | `/cache/api/run` | Trigger manual test run |
| GET | `/cache/api/test/:modelId` | Live test a single model |
| GET | `/cache/api/compare/:m1/:m2` | Compare two models |
| GET | `/cache/api/model/:id/history` | Model test history |

For detailed API documentation including request/response schemas, authentication, and examples, see the [OpenAPI Specification](docs/api-spec.yaml).

You can view the API documentation using:
- [Swagger Editor](https://editor.swagger.io/) - Paste the contents of `docs/api-spec.yaml`
- [Redoc](https://redocly.github.io/redoc/) - Generate beautiful API docs
- [Postman](https://www.postman.com/) - Import the OpenAPI spec for testing

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

For detailed architecture documentation including component diagrams, data flow, and deployment considerations, see [docs/architecture.md](docs/architecture.md).

## Database Migrations

The project uses a versioned migration system to manage database schema changes. Migrations are tracked in a `schema_migrations` table and run automatically on server start.

### Checking Migration Status

```bash
bun run db:migrate:status
```

This shows all migrations and their status (Applied/Pending).

### Running Migrations

Migrations run automatically when the server starts. To run manually:

```bash
bun run db:init
# or
bun run db:migrate
```

### Creating New Migrations

1. Create a new file in `src/db/migrations/` with format `XXX_description.ts` (e.g., `005_add_user_table.ts`)

2. Export a `Migration` object with an incremented version number:

```typescript
import type { Database } from "bun:sqlite";
import type { Migration } from "./types.ts";

export const migration: Migration = {
  version: 5,
  name: "add_user_table",
  up: (db: Database) => {
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  },
};
```

3. Add the migration to `src/db/migrations/index.ts`:

```typescript
import { migration as m005 } from "./005_add_user_table.ts";

export const ALL_MIGRATIONS: Migration[] = [m001, m002, m003, m004, m005];
```

4. Run migrations:

```bash
bun run db:migrate
```

### Migration Best Practices

- Always increment version numbers sequentially
- Never modify existing migration files after they've been applied
- Use descriptive names for migrations
- Test migrations on a copy of production data before deploying
- Migrations are forward-only (no rollback support)

## Tech Stack

- **Runtime:** Bun
- **Web Framework:** Hono
- **Database:** SQLite (bun:sqlite)
- **Frontend:** Vanilla JS + Chart.js
- **Styling:** Custom terminal aesthetic

## Environment Variables

See `.env.example` for a template with all available configuration options. The database is automatically initialized and migrations are run on first server start.

| Variable | Description | Default |
|----------|-------------|---------|
| `VENICE_API_KEY` | Venice API key (required) | - |
| `PORT` | Server port (must be 1-65535) | 3000 |
| `ALLOWED_ORIGINS` | CORS origins (comma-separated) | localhost:3000, localhost:3001, signal.venice.guru |
| `NODE_ENV` | Environment mode | - |
| `DEBUG_API_REQUESTS` | Enable verbose API request/response logging | false |
| `DASHBOARD_API_KEY` | API key for dashboard authentication (min 16 chars) | - (disabled) |
| `LOG_FORMAT` | Log output format: 'text' or 'json' | text |

### TestConfig Options

The `TestConfig` interface supports these additional options:

| Option | Description | Default |
|--------|-------------|---------|
| `requestTimeoutMs` | API request timeout in milliseconds | 30000 (30s) |

### Configuration Validation

The application validates all configuration at startup:
- If `VENICE_API_KEY` is missing, the application will fail with: `"VENICE_API_KEY environment variable is required. Get your key at https://venice.ai/api"`
- If `PORT` is invalid, the application will fail with: `"PORT must be a number between 1 and 65535, got: <value>"`

### Troubleshooting

**Error: VENICE_API_KEY environment variable is required**
- Ensure you have set the `VENICE_API_KEY` environment variable
- You can also use `API_KEY_VENICE` as an alternative

**Error: PORT must be a number between 1 and 65535**
- Check that `PORT` is a valid integer within the allowed range
- Remove the `PORT` variable to use the default (3000)

**Debugging API issues**
- Set `DEBUG_API_REQUESTS=true` to enable verbose request/response logging
- Each API call includes a unique request ID (e.g., `[API:a1b2c3d4]`) for correlation
- Debug logs show timestamps, request methods, URLs, payloads, and response details

**Database migration errors**
- Check migration status: `bun run db:migrate:status`
- If migrations are stuck, delete `./data/cache-health.db` and run `bun run db:init`
- Never modify existing migration files after they've been applied

**Scheduler not running**
- Check `/cache/api/scheduler` endpoint for status
- Verify DIEM balance is above minimum (0.001)
- Check logs: `curl http://localhost:3000/cache/api/logs`

**High memory usage**
- Cache cleanup runs every 5 minutes automatically
- Check cache stats: `curl http://localhost:3000/cache/api/cache-stats`
- Reduce `DEFAULT_TTL_MS` in `src/config/constants.ts` if needed

**Rate limiting issues**
- Default: 100 requests/minute per IP
- Check rate limit headers: `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- Increase limit in `src/server/middleware/rateLimiter.ts` if needed

**CORS errors in browser**
- Add your origin to `ALLOWED_ORIGINS` environment variable
- Format: `http://localhost:3000,http://localhost:3001`
- In production, set `NODE_ENV=production` for stricter CORS

**Tests failing with timeout errors**
- Increase `requestTimeoutMs` in test config
- Check Venice API status
- Verify network connectivity

## Observability

The application includes comprehensive observability features for production monitoring.

### Structured Logging

Enable JSON-formatted logs for log aggregation systems:

```bash
export LOG_FORMAT=json
```

JSON log entries include:
- `timestamp`: ISO 8601 timestamp
- `level`: Log level (INFO, WARN, ERROR)
- `message`: Log message
- `data`: Additional structured data (optional)
- `requestId`: API request correlation ID (optional)
- `correlationId`: Test run correlation ID (optional)

Example JSON log:
```json
{"timestamp":"2025-01-15T10:30:00.000Z","level":"INFO","message":"Testing: llama-3.3-70b","correlationId":"a1b2c3d4-e5f6-7890-abcd-ef1234567890"}
```

### Prometheus Metrics

The `/cache/api/metrics` endpoint exposes Prometheus-compatible metrics:

```bash
# Prometheus format (default)
curl http://localhost:3000/cache/api/metrics

# JSON format
curl http://localhost:3000/cache/api/metrics?format=json
```

**Available Metrics:**

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `test_duration_seconds` | Histogram | Test execution time | `test_name` |
| `api_response_time_seconds` | Histogram | Venice API response time | `endpoint`, `status_code` |
| `cache_hits_total` | Counter | In-memory cache hits | `cache_key` |
| `cache_misses_total` | Counter | In-memory cache misses | `cache_key` |
| `errors_total` | Counter | Errors by type | `error_type`, `model_id` |
| `test_results_total` | Counter | Test outcomes | `test_name`, `success` |
| `active_tests` | Gauge | Currently running tests | - |
| `scheduler_cycle_duration_seconds` | Histogram | Scheduler cycle time | - |
| `process_uptime_seconds` | Gauge | Process uptime | - |

**Prometheus Configuration Example:**

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'venice-cache-monitor'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/cache/api/metrics'
    scrape_interval: 30s
```

### Health Check

The `/cache/api/health` endpoint includes a metrics summary:

```bash
curl http://localhost:3000/cache/api/health
```

Response includes:
- `status`: healthy | degraded | unhealthy
- `metrics.totalErrors`: Total error count
- `metrics.avgApiResponseTimeMs`: Average API response time
- `metrics.totalTestRuns`: Total test executions
- `metrics.testSuccessRate`: Test success percentage

### Correlation IDs

Every test run generates a unique correlation ID that can be used to trace requests across the system. When `DEBUG_API_REQUESTS=true`, correlation IDs appear in logs for distributed tracing.

## Security Configuration

The dashboard includes optional API key authentication and rate limiting for production deployments.

### API Key Authentication

To enable authentication, set the `DASHBOARD_API_KEY` environment variable:

```bash
# Generate a secure API key
openssl rand -hex 32

# Set in your environment
export DASHBOARD_API_KEY="your-generated-key-here"
```

When enabled, all API requests must include the `X-API-Key` header:

```bash
curl -H "X-API-Key: your-api-key" http://localhost:3000/cache/api/stats
```

**Bypass paths** (no authentication required):
- `/health` - Root health check
- `/cache/health` - Cache health check
- `/cache/api/health` - API health check

### Rate Limiting

Rate limiting is always enabled:
- **100 requests per minute** per IP address
- Rate limit headers included in all responses:
  - `X-RateLimit-Limit`: Maximum requests per window
  - `X-RateLimit-Remaining`: Requests remaining in current window
  - `X-RateLimit-Reset`: Unix timestamp when the window resets

When rate limited, the API returns HTTP 429 with a `Retry-After` header.

### Production Deployment

For production deployments, we recommend:

1. **Set `DASHBOARD_API_KEY`** - Always enable authentication in production
2. **Set `NODE_ENV=production`** - Enables stricter CORS (no localhost wildcards)
3. **Configure `ALLOWED_ORIGINS`** - Only include trusted domains

```bash
export NODE_ENV=production
export DASHBOARD_API_KEY=$(openssl rand -hex 32)
export ALLOWED_ORIGINS=https://your-domain.com
```

### Single-Server Deployment Limitation

> ⚠️ **Important**: This application is designed for **single-server deployment only**.

The background scheduler that cycles through models does not use distributed locking. Running multiple instances of this application simultaneously will cause:

- **Duplicate test runs** - Each instance will test the same models independently
- **Increased API costs** - Double (or more) token consumption
- **Data inconsistency** - Test results may be recorded multiple times
- **Rate limiting issues** - Hitting Venice API rate limits faster

**Recommended deployment patterns:**

1. **Single container/process** - Run one instance behind a load balancer (sticky sessions not required for read-only dashboard)
2. **Separate read replicas** - If you need horizontal scaling, run the scheduler on only one instance and use read-only dashboard instances pointing to a shared SQLite database (with proper file locking)

**If you need multi-server deployment:**

For true horizontal scaling of the scheduler, you would need to implement:
- Distributed locking (e.g., Redis-based locks)
- A shared database (PostgreSQL instead of SQLite)
- Leader election for the scheduler

These features are not currently implemented. For most use cases, a single server with 256MB+ RAM is sufficient to monitor all Venice models.

## Key Finding: Only Some Frontier Models Support Caching

Prompt caching is a provider-level feature - only models whose upstream providers support caching will return cached tokens through Venice. Most open-source and smaller models do not support caching at the provider level.

| Provider | Models | Caching Status |
|----------|--------|----------------|
| Zhipu | GLM 4.6, GLM 4.7, GLM 4.6V | ✅ Working (78-99% hit rates) |
| xAI | Grok 41 Fast | ✅ Working (80%+ hit rates) |
| DeepSeek | DeepSeek V3.2 | ✅ Working |
| Kimi | Kimi K2 Thinking | ✅ Working |
| Meta | Llama 3.2, Llama 3.3 | ❌ No caching support |
| Mistral | Mistral 31 24B | ❌ No caching support |
| Qwen | Qwen3 series | ❌ No caching support |
| Google | Gemini, Gemma | ❌ No caching support |
| Venice | Venice Uncensored | ❌ No caching support |

Use the Cache Microscope to verify caching behavior yourself with live API calls.

## License

MIT
