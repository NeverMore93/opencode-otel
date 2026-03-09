<!--
Sync Impact Report
===================
Version change: 1.0.0 → 1.1.0 (MINOR — new principle added)

Modified principles: none
Added sections:
  - Principle VI: Version-First Changes
Removed sections: none

Templates requiring updates:
  - .specify/templates/plan-template.md — ✅ no update needed (Constitution Check section is generic)
  - .specify/templates/spec-template.md — ✅ no update needed (no version/README references)
  - .specify/templates/tasks-template.md — ✅ no update needed (task format unchanged)
  - README.md — ✅ no update needed now (principle enforces future syncs)
  - specs/constitution.md — ⚠ pending (canonical copy should be updated to match)

Follow-up TODOs: none
-->

# opencode-otel Constitution

## Core Principles

### I. OTel-First Instrumentation

All observability data collection uses the standard OpenTelemetry SDK as the single instrumentation layer. No vendor-specific instrumentation code in hook handlers. Vendor differentiation happens exclusively at the exporter/SpanProcessor level. This ensures:
- Instrument once, export everywhere
- Backend switching is a config change, not a code change
- Alignment with OpenTelemetry GenAI semantic conventions

### II. Multi-Backend Export

The plugin MUST support simultaneous export to multiple observability backends via SpanProcessor fan-out:
- **Langfuse**: OTLP HTTP to `/api/public/otel/v1/traces` (Basic Auth)
- **LangSmith**: OTLP HTTP to `/otel/v1/traces` (x-api-key header)
- **Generic OTEL**: Any OTLP-compatible backend (Jaeger, Datadog, Grafana Tempo, etc.)

Each backend is independently configurable (enabled/disabled, endpoint, auth). Adding a new backend requires zero instrumentation changes.

### III. Non-Intrusive & Fault-Tolerant

The plugin MUST NEVER affect OpenCode core functionality:
- All hook handlers wrapped in error boundaries (try/catch → `client.app.log`, never throw)
- Export failures are silent — SDK retries then drops, no user-visible impact
- Plugin initialization failure results in graceful degradation (no hooks registered, not a crash)
- Async fire-and-forget pattern for all OTEL operations — never block the event loop

### IV. Privacy by Default

Data sensitivity is a hard constraint, not a feature toggle:
- **MUST NOT** capture: API keys, user credentials, message text content, file contents, tool output
- **MAY** capture: session IDs, tool names, model names, agent names, event types, timestamps, durations, span status
- All attribute values truncated to 256 characters maximum
- Sensitive data filtering is enforced at the hook level before any span/log is created

### V. Zero-Config Bootstrap

The plugin MUST work out-of-box with minimal configuration:
- Auto-read standard `OTEL_EXPORTER_OTLP_*` environment variables
- OpenCode's `experimental.openTelemetry: true` is the only prerequisite for basic functionality
- Backend-specific config (Langfuse keys, LangSmith API key) provided via environment variables or plugin config file
- Sensible defaults for all batch/export parameters

### VI. Version-First Changes

Any code or configuration change MUST follow this sequence:
1. **Bump the version number first** — update `version` in `package.json` before making functional changes. Follow semver: MAJOR for breaking changes, MINOR for new features, PATCH for bug fixes.
2. **Implement the change** — make the functional modifications.
3. **Sync README.md** — after all changes are complete, update `README.md` to reflect the new version number, any new features, changed configuration, or removed functionality.

This ensures the version is never stale and the README always matches the published artifact. Skipping or reordering these steps is a governance violation.

## Technical Constraints

### Runtime
- **Bun** (TypeScript/JavaScript) — no gRPC native modules, broken AsyncLocalStorage
- **OTLP HTTP only** — both JSON and protobuf supported, no gRPC
- **Manual context propagation** — session-scoped `Map<sessionID, Context>` instead of AsyncLocalStorage

### Plugin Model
- OpenCode npm plugin (`@opencode-ai/plugin` interface)
- Hooks: `event`, `chat.message`, `tool.execute.before`, `tool.execute.after`
- Distribution: npm public registry as `opencode-otel`

### Dependencies
- `@opentelemetry/api` (stable) — core API
- `@opentelemetry/sdk-trace-base` (stable) — TracerProvider, SpanProcessors
- `@opentelemetry/sdk-logs` (experimental) — LoggerProvider
- `@opentelemetry/exporter-trace-otlp-http` — OTLP HTTP trace export
- `@opentelemetry/exporter-logs-otlp-http` — OTLP HTTP log export
- `@opentelemetry/resources` — resource attributes

### Build
- tsup (ESM output, tree-shaking, DTS generation)
- External `@opencode-ai/*` (provided by host runtime)
- Bundle OTEL deps (not provided by host)

## Quality Standards

### Code
- Files < 200 lines, functions < 50 lines
- Strict TypeScript (`strict: true`)
- No mutation — immutable patterns for all data transformations
- No `console.log` — use `client.app.log()` for plugin logging

### Testing
- Unit tests with `InMemorySpanExporter` — verify span attributes, parent-child relationships
- Integration tests with mock OTLP collector — verify export format and batching
- Target 80%+ coverage for hook handlers and telemetry setup

### Performance
- Hook execution adds < 50ms to request processing
- Batch export every 5s (configurable)
- Max queue size 2048 (configurable)
- Graceful shutdown with 5s timeout

## Governance

Constitution supersedes all other practices. Amendments require:
1. Documentation of rationale
2. Impact analysis on existing backends
3. Backward compatibility assessment (config format, env var names)

**Version**: 1.1.0 | **Ratified**: 2026-03-01 | **Last Amended**: 2026-03-07
