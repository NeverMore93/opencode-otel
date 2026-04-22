# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Project-Specific Guidelines

### What This Project Is

**opencode-otel** — an OpenCode npm plugin that forwards runtime stderr logs to any OTLP-compatible log collector via gRPC or HTTP. Business events (traces/spans) are handled by opencode-plugin-langfuse.

### Technical Context

- **Language**: TypeScript 5.5+ / Bun runtime
- **Project Type**: npm library (OpenCode plugin)
- **Dependencies**: `@opentelemetry/api`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/exporter-trace-otlp-grpc`, `@opentelemetry/api-logs`, `@opentelemetry/sdk-logs`, `@opentelemetry/exporter-logs-otlp-grpc`, `@opentelemetry/exporter-logs-otlp-http`, `@opentelemetry/resources`, `@grpc/grpc-js` (transitive)
- **Plugin SDK**: `@opencode-ai/plugin@>=1.1.0` (peer dependency)
- **Build**: tsup (ESM output, external `@opencode-ai/*`)
- **Testing**: `bun test`

### Key Constraints

- **Cannot modify OpenCode source code** — integration via npm plugin mechanism only
- **Monkey-patch `process.stderr.write`** — runtime interception of log output (JS dynamic proxy pattern)
- **gRPC primary, HTTP fallback** — company TripLog collector only accepts gRPC on :8080
- **Uses `event` hook for session lifecycle tracking** (`session.created`/`idle`/`deleted`) — creates root spans per session so all logs share the same traceId
- **No business traces/spans** — business events handled by opencode-plugin-langfuse

### Architecture

```text
Plugin Entry (src/index.ts)
  ├─ Config (src/config.ts) ← env vars + optional config file
  ├─ Log Provider (src/provider.ts) ← LoggerProvider + BatchLogRecordProcessor + gRPC/HTTP exporter
  ├─ Interceptor (src/interceptor.ts) ← monkey-patch process.stderr.write, line buffering, severity parsing
  └─ Shutdown (src/shutdown.ts) ← graceful flush on process exit
```

### Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | — | Log collector endpoint (required) |
| `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL` | `grpc` | Protocol: `grpc` or `http/json` |
| `OTEL_SERVICE_NAME` | `opencode-agent` | service.name resource attribute |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | — | Traces endpoint (optional, for session span export) |
| `OTEL_RESOURCE_ATTRIBUTES` | — | Additional resource attributes (auto-parsed by SDK) |

### Design Documents

All specs are in `specs/` directory:
- `constitution.md` — project constitution and principles
- Feature specs in `specs/010-stderr-log-forwarder/`
