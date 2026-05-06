# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Task | Command |
|------|---------|
| Install deps | `bun install` |
| Run all tests | `bun test` |
| Run a single test file | `bun test tests/unit/config.test.ts` |
| Run tests matching a pattern | `bun test --test-name-pattern "signal-specific"` |
| Build (ESM + DTS) | `bun run build` |
| Build before publish | `bun run prepublishOnly` (runs build automatically) |

No linter is configured. Build validation via `tsc` is handled by tsup during `bun run build`.

## Architecture

```text
Plugin Entry (src/index.ts) — orchestration only, wires modules together
  ├─ Config (src/config.ts)        ← env vars + otel.json file, precedence: env > file > defaults
  ├─ Provider (src/provider.ts)    ← LoggerProvider + TracerProvider, BAT resource resolution, gRPC/HTTP exporters
  ├─ Interceptor (src/interceptor.ts) ← monkey-patch process.stderr.write, line buffering, severity parsing
  ├─ Session (src/session.ts)      ← Map<sessionID, Span>, trace context per session
  ├─ Shutdown (src/shutdown.ts)    ← graceful flush on beforeExit/SIGTERM/SIGINT (5s timeout)
  └─ Version (src/version.ts)      ← reads package.json version at runtime (not hard-coded)
```

**Data flow:** stderr write → interceptor (line buffer + severity parse) → logger.emit() with active session trace context → BatchLogRecordProcessor → OTLP exporter.

**Session correlation:** The `event` hook tracks `session.created`/`idle`/`deleted` events. Each session gets a root span; all logs emitted during that session share the same `traceId`.

## Tests

Tests live in `tests/unit/` using `bun:test`. Three test files cover the core modules:
- `config.test.ts` — env var parsing, config file merging, timeout precedence, header/resource attribute decoding, `${ENV_VAR}` placeholder resolution in otel.json
- `interceptor.test.ts` — line buffering, severity parsing, stderr preservation, flush/uninstall
- `provider.test.ts` — signal routes, resource attribute resolution (BAT identity backfill, service name precedence), provider initialization

Tests manipulate `process.env` directly and use temp directories for config files (via `OTEL_PLUGIN_CONFIG_PATH`). No mocking library. See test files for helper conventions.

## Behavioral Guidelines

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

## What This Project Is

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
- **Monkey-patch `process.stderr.write`** — interceptor has a recursion guard (`inEmit` flag); if emit callback writes to stderr it is silently skipped
- **gRPC primary, HTTP fallback** — traces exporter only supports gRPC; non-gRPC traces protocol disables trace export with a warning
- **Uses `event` hook for session lifecycle tracking** (`session.created`/`idle`/`deleted`) — creates root spans per session so all logs share the same traceId
- **Session tracking uses a module-level Map, not AsyncLocalStorage** — `activeSessionId` is a plain variable; concurrent session interleaving will mis-tag logs
- **Plugin stays inactive** if `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` is not set — logs a status message but does not install the interceptor
- **No business traces/spans** — business events handled by opencode-plugin-langfuse
- **Version-first change policy** — any code/config change MUST bump `version` in `package.json` first (semver), implement, then sync `README.md`. See `specs/constitution.md`.

### Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | — | Log collector endpoint (required) |
| `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL` | `grpc` | Protocol: `grpc` or `http/json` |
| `OTEL_SERVICE_NAME` | `opencode-agent` | service.name resource attribute |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | — | Traces endpoint (optional, for session span export) |
| `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` | `grpc` | Trace protocol; only `grpc` is supported |
| `OTEL_EXPORTER_OTLP_TIMEOUT` | — | Shared OTLP timeout in ms; signal-specific overrides win |
| `OTEL_EXPORTER_OTLP_LOGS_TIMEOUT` | — | Log-specific timeout in ms (overrides shared) |
| `OTEL_EXPORTER_OTLP_TRACES_TIMEOUT` | — | Trace-specific timeout in ms (overrides shared) |
| `OTEL_RESOURCE_ATTRIBUTES` | — | Additional resource attributes (auto-parsed by SDK) |
| `OTEL_EXPORTER_OTLP_HEADERS` | — | Comma-separated `key=value` auth headers |
| `OTEL_PLUGIN_CONFIG_PATH` | — | Override default config file path (absolute path) |
| `OTEL_MAX_LINE_LENGTH` | `4096` | Max stderr line length before truncation |

**Config file**: `~/.config/opencode/plugins/otel.json` (override with `OTEL_PLUGIN_CONFIG_PATH`). Supports `${ENV_VAR}` placeholders in string values. Env vars always win over config file values.

**Timeout precedence** (per OTEL spec): `OTEL_EXPORTER_OTLP_LOGS_TIMEOUT` > `OTEL_EXPORTER_OTLP_TIMEOUT` for logs; `OTEL_EXPORTER_OTLP_TRACES_TIMEOUT` > `OTEL_EXPORTER_OTLP_TIMEOUT` for traces.

**service.name precedence**: `OTEL_SERVICE_NAME` > `OTEL_RESOURCE_ATTRIBUTES[service.name]` > `otel.json serviceName` > `PAAS_APP_APPID` > default `"opencode-agent"`. When inputs disagree, the higher-priority source wins and a warning is emitted.

### Design Documents

All specs are in `specs/` directory:
- `constitution.md` — project constitution and principles (governance, quality standards, version-first change policy)
- `contracts/` — plugin hook and OTEL export contracts
- `data-model.md` — data model definitions
- Feature specs in numbered directories (e.g. `specs/001-add-gitignore/`)
