# Contributing to Venice Caching Health Monitor

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Style](#code-style)
- [Testing Guidelines](#testing-guidelines)
- [Pull Request Process](#pull-request-process)
- [Commit Message Guidelines](#commit-message-guidelines)

## Code of Conduct

Be respectful, inclusive, and professional in all interactions.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone <your-fork-url>`
3. Add upstream remote: `git remote add upstream <original-repo-url>`
4. Follow the development setup in README.md

## Development Workflow

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Write code following our style guidelines
   - Add tests for new functionality
   - Update documentation as needed

3. **Run tests**
   ```bash
   bun test
   ```

4. **Commit your changes**
   ```bash
   git commit -m "feat: add new feature"
   ```

5. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Open a Pull Request**

## Code Style

### TypeScript

- Use **TypeScript** for all new code
- Enable strict type checking
- Prefer interfaces over types for object shapes
- Use explicit return types for functions

**Example**:
```typescript
interface TestResult {
  model: string;
  cachingWorks: boolean;
  cacheHitRate: number;
}

function runTest(modelId: string): Promise<TestResult> {
  // Implementation
}
```

### Naming Conventions

- **Files**: kebab-case (`api-client.ts`, `test-runner.ts`)
- **Classes**: PascalCase (`Scheduler`, `MetricsCollector`)
- **Functions**: camelCase (`fetchModels`, `saveResult`)
- **Constants**: UPPER_SNAKE_CASE (`MIN_DIEM_BALANCE`, `DEFAULT_TTL_MS`)
- **Interfaces**: PascalCase (`TestConfig`, `VeniceModel`)

### Code Organization

- Keep functions small and focused (< 50 lines)
- Extract complex logic into separate functions
- Use early returns to reduce nesting
- Add comments for complex algorithms only

**Example**:
```typescript
// Good: Early return reduces nesting
function processResult(result: TestResult | null): void {
  if (!result) return;
  if (!result.cachingWorks) return;

  saveToDatabase(result);
}

// Avoid: Deep nesting
function processResult(result: TestResult | null): void {
  if (result) {
    if (result.cachingWorks) {
      saveToDatabase(result);
    }
  }
}
```

### Error Handling

- Use try-catch for async operations
- Return structured errors with types
- Log errors with context

**Example**:
```typescript
try {
  const result = await fetchData();
  return result;
} catch (error) {
  log("error", "Failed to fetch data", {
    error: String(error),
    context: "additional info"
  });
  throw error;
}
```

## Testing Guidelines

### Test Structure

- Use **Bun's test runner** (Jest-compatible)
- Follow Arrange-Act-Assert pattern
- One assertion per test when possible
- Use descriptive test names

**Example**:
```typescript
import { describe, test, expect } from "bun:test";

describe("calculateCacheRate", () => {
  test("should return 0 when no tokens are cached", () => {
    // Arrange
    const usage = { promptTokens: 100, cachedTokens: 0 };

    // Act
    const rate = calculateCacheRate(usage);

    // Assert
    expect(rate).toBe(0);
  });
});
```

### Test Coverage

- **Utility functions**: >80% coverage
- **Core logic**: >70% coverage
- **Database operations**: >60% coverage

Run coverage report:
```bash
bun test --coverage
```

### Mocking

- Use mock factories from `tests/helpers/mocks.ts`
- Never make real API calls in tests
- Use in-memory database for database tests

See `tests/README.md` for detailed testing documentation.

## Pull Request Process

### Before Submitting

- [ ] All tests pass (`bun test`)
- [ ] Code follows style guidelines
- [ ] Documentation is updated
- [ ] Commit messages follow conventions
- [ ] No console.log statements (use logger)
- [ ] TypeScript compiles without errors

### PR Title Format

Use conventional commit format:
- `feat: add new feature`
- `fix: resolve bug`
- `docs: update documentation`
- `test: add tests`
- `refactor: improve code structure`
- `chore: update dependencies`

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
Describe how you tested your changes

## Checklist
- [ ] Tests pass
- [ ] Documentation updated
- [ ] No breaking changes (or documented)
```

### Review Process

1. Automated checks must pass (tests, linting)
2. At least one maintainer approval required
3. Address review feedback
4. Squash commits before merge (if requested)

## Commit Message Guidelines

Follow [Conventional Commits](https://www.conventionalcommits.org/):

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **test**: Adding or updating tests
- **refactor**: Code refactoring
- **perf**: Performance improvements
- **chore**: Maintenance tasks
- **ci**: CI/CD changes

### Examples

```bash
feat(api): add model comparison endpoint

Add /cache/api/compare/:m1/:m2 endpoint to compare two models side-by-side.
Includes cache rate comparison and reproducible curl commands.

Closes #123

---

fix(scheduler): prevent duplicate balance check timers

Clear existing timer before creating new one to avoid memory leaks.

---

docs(readme): add troubleshooting section

Add common issues and solutions for database migrations, scheduler, and CORS.
```

### Scope

Optional, but recommended:
- `api` - API endpoints
- `scheduler` - Scheduler logic
- `db` - Database operations
- `tests` - Test suite
- `docs` - Documentation
- `ui` - Dashboard frontend

## Questions?

Open an issue or reach out to maintainers.

Thank you for contributing!
