# Test Suite Documentation

This directory contains the comprehensive test suite for the Venice Caching Test Suite application. Tests are written using **Bun's built-in test runner** which provides Jest-compatible APIs.

## Running Tests

### All Tests

```bash
bun test
```

### Watch Mode

```bash
bun test --watch
```

### With Coverage

```bash
bun test --coverage
```

### Specific Test Categories

```bash
# Unit tests only
bun test tests/unit

# Integration tests only
bun test tests/integration

# Utility tests only
bun test tests/unit/utils

# Core logic tests only
bun test tests/unit/core

# Database tests only
bun test tests/unit/db
```

### NPM Scripts

The following npm scripts are available:

```bash
bun run test          # Run all tests
bun run test:watch    # Run tests in watch mode
bun run test:coverage # Run tests with coverage
bun run test:unit     # Run unit tests only
bun run test:integration # Run integration tests only
bun run test:utils    # Run utility tests only
bun run test:core     # Run core tests only
bun run test:db       # Run database tests only
```

## Test Structure

```
tests/
├── unit/                    # Unit tests for individual functions
│   ├── utils/              # Utility function tests
│   │   ├── http.test.ts    # HTTP utilities (fetchWithTimeout, parseJsonResponse, delay)
│   │   ├── retry.test.ts   # Retry logic (calculateBackoffDelay, isTimeoutError, withRetry)
│   │   └── validation.test.ts # Validation helpers (clampInt, safeJsonParse)
│   ├── core/               # Core logic tests
│   │   ├── api.test.ts     # API client (extractUsage, fetchModels, sendRequest)
│   │   ├── runner.test.ts  # Test runner (testModel, runTests)
│   │   └── metrics.test.ts # Metrics calculation
│   └── db/                 # Database tests
│       └── repository.test.ts # All repository operations
├── integration/            # Integration tests
│   └── api-integration.test.ts # Complete request/response cycles
├── helpers/                # Test utilities
│   ├── mocks.ts           # Mock factories
│   └── fixtures.ts        # Sample test data
├── setup.ts               # Global test configuration
└── README.md              # This file
```

## Writing Tests

### Basic Test Structure

```typescript
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

describe("functionName", () => {
  beforeEach(() => {
    // Setup before each test
  });

  afterEach(() => {
    // Cleanup after each test
  });

  test("should do something specific", () => {
    // Arrange
    const input = "test";

    // Act
    const result = functionToTest(input);

    // Assert
    expect(result).toBe("expected");
  });
});
```

### Using Mocks

Import mock factories from `tests/helpers/mocks.ts`:

```typescript
import {
  createMockResponse,
  createMockFetch,
  createMockModel,
  createMockUsage,
  createMockTestResult,
} from "../../helpers/mocks.ts";
import { mockGlobalFetch, restoreGlobalFetch } from "../../setup.ts";

describe("API calls", () => {
  afterEach(() => {
    restoreGlobalFetch();
  });

  test("should fetch data", async () => {
    mockGlobalFetch(createMockFetch([{
      response: createMockResponse({
        status: 200,
        body: { data: "test" },
      }),
    }]));

    // Your test code...
  });
});
```

### Using Fixtures

Import sample data from `tests/helpers/fixtures.ts`:

```typescript
import {
  SAMPLE_MODELS,
  USAGE_WITH_CACHING,
  SUCCESSFUL_CACHE_RESULT,
  RATE_LIMIT_RESPONSE,
} from "../../helpers/fixtures.ts";
```

### Testing Database Operations

Use the in-memory database from setup:

```typescript
import { createTestDatabase, clearTestDatabase, seedTestDatabase } from "../../setup.ts";
import { Database } from "bun:sqlite";

describe("database operations", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDatabase();
    seedTestDatabase(db); // Optional: add sample data
  });

  afterEach(() => {
    db.close();
  });

  test("should query data", () => {
    const results = db.prepare("SELECT * FROM test_results").all();
    expect(results.length).toBeGreaterThan(0);
  });
});
```

## Available Mock Factories

### Response Mocks

- `createMockResponse(options)` - Create a mock fetch Response
- `createMockFetch(responses)` - Create a mock fetch function
- `createTimeoutFetch(timeoutMs)` - Create a fetch that times out

### Data Mocks

- `createMockModel(overrides)` - Create a VeniceModel
- `createMockUsage(overrides)` - Create a UsageInfo
- `createMockTestResult(overrides)` - Create a TestResult
- `createMockPayload(overrides)` - Create a RequestPayload
- `createMockRequestResult(overrides)` - Create a RequestResult
- `createMockTestConfig(overrides)` - Create a TestConfig

### API Response Mocks

- `createMockChatCompletionResponse(usage)` - Chat completion response
- `createMockModelsResponse(models)` - Models list response

### Tracking Utilities

- `createTrackingFetch(mockFetch)` - Wraps fetch to track all calls

## Test Fixtures

### Sample Data

- `SAMPLE_MODELS` - Array of VeniceModel objects
- `USAGE_WITH_CACHING` - UsageInfo with cache hits
- `USAGE_WITHOUT_CACHING` - UsageInfo with no cache
- `SUCCESSFUL_CACHE_RESULT` - TestResult with working cache
- `FAILED_CACHE_RESULT` - TestResult with no cache
- `ERROR_RESULT` - TestResult with error

### Database Rows

- `SAMPLE_TEST_RESULT_ROWS` - TestResultRow array
- `SAMPLE_TOKEN_USAGE_ROWS` - TokenUsageRow array

### API Responses

- `RATE_LIMIT_RESPONSE` - HTTP 429 error body
- `INTERNAL_SERVER_ERROR_RESPONSE` - HTTP 500 error body
- `HTML_ERROR_PAGE` - HTML error page content

## Setup Utilities

### Global Fetch Mocking

```typescript
import { mockGlobalFetch, restoreGlobalFetch } from "../setup.ts";

mockGlobalFetch(async () => createMockResponse({ status: 200 }));
// ... run tests ...
restoreGlobalFetch();
```

### Test Database

```typescript
import { createTestDatabase, clearTestDatabase, seedTestDatabase } from "../setup.ts";

const db = createTestDatabase();  // In-memory SQLite
seedTestDatabase(db);              // Add sample data
clearTestDatabase(db);             // Remove all data
db.close();                        // Cleanup
```

### Console Capture

```typescript
import { captureConsole } from "../setup.ts";

const capture = captureConsole();
console.log("test message");
capture.restore();

expect(capture.logs).toContain("test message");
```

## Best Practices

1. **Isolation**: Each test should be independent. Use `beforeEach`/`afterEach` for setup/cleanup.

2. **Descriptive Names**: Test names should describe expected behavior:
   ```typescript
   test("should return null when header is missing", ...);
   ```

3. **Arrange-Act-Assert**: Structure tests clearly:
   ```typescript
   // Arrange
   const input = { ... };

   // Act
   const result = functionToTest(input);

   // Assert
   expect(result).toBe(expected);
   ```

4. **Test Edge Cases**: Include tests for boundary conditions, null values, empty arrays, etc.

5. **Test Error Paths**: Test error handling as thoroughly as happy paths.

6. **Mock External Dependencies**: Never make real API calls or use production database.

7. **Fast Execution**: Tests should run in milliseconds. Use in-memory database and minimal delays.

## Coverage Expectations

- **Utility Functions**: >80% coverage
- **Core Logic**: >70% coverage
- **Database Operations**: >60% coverage

Run coverage report:

```bash
bun test --coverage
```

## CI/CD Integration

Tests are designed to run in CI/CD pipelines:

```yaml
# Example GitHub Actions
- name: Run tests
  run: bun test

- name: Run tests with coverage
  run: bun test --coverage
```

Environment variables are set in `tests/setup.ts`:
- `VENICE_API_KEY=test-api-key-for-testing`
- `NODE_ENV=test`
- `DEBUG_API_REQUESTS=false`
