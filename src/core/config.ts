/**
 * Configuration and constants for Venice Caching Test Suite
 */

import type { TestConfig } from "./types.ts";
import { env } from "../config/env.ts";
import { API_CONSTANTS, TEST_CONSTANTS } from "../config/constants.ts";

export const VENICE_API_URL = API_CONSTANTS.VENICE_API_URL;

export function getApiKey(): string {
  return env.veniceApiKey;
}

export const DEFAULT_CONFIG: TestConfig = {
  runBasicTest: true,
  runPromptSizeTest: false,      // Disabled to reduce API usage
  runPartialCacheTest: false,    // Disabled to reduce API usage
  runPersistenceTest: false,     // Disabled to reduce API usage
  runTTLTest: false,             // Disabled to reduce API usage
  maxModels: 0, // 0 = all models; used by CLI only (scheduler cycles through all)
  delayBetweenModels: TEST_CONSTANTS.DEFAULT_DELAY_BETWEEN_MODELS_MS,
  cachingSupportThreshold: {
    minTestsWithCaching: 1,     // Only basic test runs now
    minCacheHitRate: 50,        // Cache hit rate must be ≥50%
    minSuccessRate: 60,         // At least 60% of tests must succeed
  },
  maxTokens: TEST_CONSTANTS.DEFAULT_MAX_TOKENS,
  cacheControlPlacement: 'system',
  delayBetweenRequests: TEST_CONSTANTS.DEFAULT_DELAY_BETWEEN_REQUESTS_MS,
  ttlDelays: [...TEST_CONSTANTS.DEFAULT_TTL_DELAYS_SECONDS],
  injectTestRunId: true,        // Enable test run ID injection by default
  isolationDelay: TEST_CONSTANTS.DEFAULT_ISOLATION_DELAY_MS,
  persistenceRequests: TEST_CONSTANTS.DEFAULT_PERSISTENCE_REQUESTS,
  basicTestRepetitions: TEST_CONSTANTS.DEFAULT_BASIC_TEST_REPETITIONS,
  requestTimeoutMs: API_CONSTANTS.REQUEST_TIMEOUT_MS,
};

export type PromptSize = "small" | "medium" | "large" | "xlarge";

// Prompt caching typically requires 1024+ tokens to activate.
// These prompts are sized to test different thresholds:
// - small: ~150 tokens (below typical threshold)
// - medium: ~500 tokens (may trigger on some providers)
// - large: ~1200 tokens (should trigger caching)
// - xlarge: ~2000 tokens (well above threshold)

const KNOWLEDGE_BASE = `
## Technical Knowledge Base

### Programming Languages
You have expertise in: TypeScript, JavaScript, Python, Rust, Go, Java, Kotlin, C++, C#, Ruby, PHP, Swift, Scala, Haskell, Erlang, Elixir, Clojure, F#, OCaml, Lua, Perl, R, Julia, MATLAB, Assembly, SQL, GraphQL, and shell scripting languages including Bash, Zsh, PowerShell, and Fish.

### Frontend Technologies
Frameworks: React, Vue.js, Angular, Svelte, SolidJS, Qwik, Astro, Next.js, Nuxt.js, Remix, Gatsby.
State Management: Redux, MobX, Zustand, Jotai, Recoil, XState, Pinia, Vuex.
Styling: CSS, Sass, Less, Tailwind CSS, Styled Components, Emotion, CSS Modules, PostCSS.
Build Tools: Webpack, Vite, Rollup, esbuild, Parcel, Turbopack, SWC, Babel.
Testing: Jest, Vitest, Cypress, Playwright, Testing Library, Storybook, Chromatic.

### Backend Technologies
Runtime: Node.js, Bun, Deno, Python, Go, Rust, Java, .NET, Ruby, PHP.
Frameworks: Express, Fastify, NestJS, Hono, Django, FastAPI, Flask, Gin, Echo, Actix, Spring Boot, ASP.NET, Rails, Laravel.
API: REST, GraphQL, gRPC, tRPC, WebSockets, Server-Sent Events, WebHooks.
Authentication: OAuth2, OIDC, JWT, SAML, Passport.js, Auth0, Clerk, Supabase Auth.

### Databases
Relational: PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, Oracle, CockroachDB, TiDB.
Document: MongoDB, CouchDB, Amazon DocumentDB, Azure Cosmos DB.
Key-Value: Redis, Memcached, Amazon ElastiCache, Upstash.
Wide-Column: Cassandra, ScyllaDB, HBase, Amazon Keyspaces.
Graph: Neo4j, Amazon Neptune, ArangoDB, JanusGraph.
Time-Series: InfluxDB, TimescaleDB, Prometheus, QuestDB.
Search: Elasticsearch, OpenSearch, Algolia, Meilisearch, Typesense.
Vector: Pinecone, Weaviate, Qdrant, Milvus, Chroma, pgvector.

### Cloud & Infrastructure
Providers: AWS, Google Cloud Platform, Microsoft Azure, DigitalOcean, Linode, Vultr, Hetzner, Cloudflare.
Compute: EC2, Lambda, ECS, EKS, Fargate, Cloud Run, Cloud Functions, Azure Functions.
Storage: S3, EBS, EFS, Cloud Storage, Blob Storage, R2.
Networking: VPC, Route 53, CloudFront, Cloud CDN, Azure CDN, Load Balancers.
IaC: Terraform, Pulumi, CloudFormation, CDK, Ansible, Chef, Puppet.
Containers: Docker, Podman, containerd, Kubernetes, Helm, Kustomize.
Service Mesh: Istio, Linkerd, Consul Connect, AWS App Mesh.

### DevOps & SRE
CI/CD: GitHub Actions, GitLab CI, CircleCI, Jenkins, ArgoCD, Flux, Tekton.
Monitoring: Prometheus, Grafana, Datadog, New Relic, Honeycomb, Jaeger, Zipkin.
Logging: ELK Stack, Loki, Fluentd, Vector, CloudWatch Logs.
Alerting: PagerDuty, OpsGenie, Slack integrations, custom webhooks.
Security: Vault, SOPS, Sealed Secrets, AWS Secrets Manager, certificate management.

### Architecture Patterns
Microservices, Monolithic, Serverless, Event-Driven, CQRS, Event Sourcing, Domain-Driven Design, Hexagonal Architecture, Clean Architecture, Vertical Slice Architecture, Modular Monolith.

### Best Practices
Code Quality: SOLID principles, DRY, KISS, YAGNI, clean code, refactoring patterns.
Testing: Unit tests, integration tests, e2e tests, TDD, BDD, property-based testing.
Security: OWASP Top 10, secure coding, input validation, output encoding, CSP, CORS.
Performance: Caching strategies, lazy loading, code splitting, database optimization, CDN usage.
Documentation: API docs, architecture decision records, runbooks, postmortems.
`;

export const PROMPTS: Record<PromptSize, string> = {
  small: "You are a helpful assistant. Be concise and accurate. Always provide working code examples when asked about programming.",

  medium: `You are an expert software engineer with deep knowledge of modern development practices.
${KNOWLEDGE_BASE.slice(0, 1500)}
Provide clear, actionable advice with code examples.`,

  large: `You are an expert software engineer and system architect with comprehensive knowledge.
${KNOWLEDGE_BASE}
Always provide production-ready code with proper error handling, types, and documentation.`,

  xlarge: `You are an elite software engineer, system architect, and technical leader with comprehensive expertise.
${KNOWLEDGE_BASE}
${KNOWLEDGE_BASE.slice(0, 2000)}
You excel at designing scalable systems, writing maintainable code, and mentoring teams. Always provide production-ready solutions with comprehensive error handling, type safety, security considerations, and thorough documentation. Consider edge cases, performance implications, and long-term maintainability in your responses.`,
};
