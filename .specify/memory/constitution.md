<!--
Sync Impact Report
===================
Version change: 1.2.0 → 1.3.0 (MINOR — add gRPC support to Technical Constraints)

Modified principles: none
Modified sections:
  - Technical Constraints → Runtime: removed "no gRPC" restriction
  - Technical Constraints → Dependencies: added gRPC exporter packages

Added sections: none
Removed sections: none

Templates requiring updates:
  - README.md — ✅ updated (gRPC configuration added)
  - CLAUDE.md — ✅ updated (gRPC deps and constraints)

Follow-up TODOs: none
-->

<!--
Sync Impact Report
===================
Version change: 1.1.1 → 1.2.0 (MINOR — remove Langfuse from mandated backends)

Modified principles:
  - Principle II: "Multi-Backend Export" — removed Langfuse-specific backend requirement,
    simplified to generic OTLP-only multi-backend support

Added sections: none
Removed sections: none

Templates requiring updates:
  - README.md — ✅ updated (Langfuse sections removed)
  - CLAUDE.md — ✅ updated (Langfuse references removed)

Follow-up TODOs: none
-->

<!--
Sync Impact Report
===================
Version change: 1.1.0 → 1.1.1 (PATCH — clarify README sync timing)

Modified principles:
  - Principle VI: "Version-First Changes" — step 3 strengthened from
    "after all changes are complete" to "with every code change"

Added sections: none
Removed sections: none

Templates requiring updates:
  - .specify/templates/plan-template.md — ✅ no update needed
  - .specify/templates/spec-template.md — ✅ no update needed
  - .specify/templates/tasks-template.md — ✅ no update needed
  - README.md — ✅ updated (string/number → string/number/boolean)

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

The plugin MUST support export to any OTLP-compatible observability backend via standard OTLP HTTP protocol:
- **Generic OTEL**: Any OTLP-compatible backend (Jaeger, Datadog, Grafana Tempo, LangSmith, Langfuse via OTLP, etc.)

Each backend is independently configurable (enabled/disabled, endpoint, auth). The plugin uses standard `OTEL_EXPORTER_OTLP_*` environment variables. No vendor-specific SDKs or dependencies.

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
- Backend-specific config (auth headers, API keys) provided via environment variables or plugin config file
- Sensible defaults for all batch/export parameters

### VI. Version-First Changes

Any code or configuration change MUST follow this sequence:
1. **Bump the version number first** — update `version` in `package.json` before making functional changes. Follow semver: MAJOR for breaking changes, MINOR for new features, PATCH for bug fixes.
2. **Implement the change** — make the functional modifications.
3. **Update README.md immediately** — every code change that affects user-facing behavior, configuration, attributes, or trace structure MUST include a corresponding README.md update in the same commit or PR. README drift is a governance violation.

README.md MUST always reflect the current state of the codebase. Do not defer README updates to a later PR or "documentation pass." If a change modifies exported attributes, configuration options, trace structure, or feature behavior, the README MUST be updated before the change is considered complete.

## Technical Constraints

### Runtime
- **Bun** (TypeScript/JavaScript) — broken AsyncLocalStorage
- **OTLP HTTP + gRPC** — HTTP/JSON (default), gRPC via `@grpc/grpc-js` (pure JS, 95% Bun compat for unary calls)
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
- `@opentelemetry/exporter-trace-otlp-grpc` — OTLP gRPC trace export
- `@opentelemetry/exporter-logs-otlp-grpc` — OTLP gRPC log export
- `@grpc/grpc-js` (transitive) — pure JS gRPC client

### Build
- tsup (ESM output, tree-shaking, DTS generation)
- External `@opencode-ai/plugin` (provided by host runtime)
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

**Version**: 1.3.0 | **Ratified**: 2026-03-01 | **Last Amended**: 2026-03-27
