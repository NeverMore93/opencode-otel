<!--
Sync Impact Report
===================
Version change: 1.3.0 → 2.0.0 (MAJOR — complete architecture pivot)

Rationale: The plugin's scope is narrowed from "full observability" to
"runtime log forwarding only". Business events (traces, spans) are now
handled by opencode-plugin-langfuse. This plugin focuses exclusively on
capturing OpenCode's runtime stderr logs and forwarding them as OTEL
LogRecords to the company's TripLog OTEL collector via gRPC.

Modified principles:
  - Principle I: Renamed from "OTel-First Instrumentation" to "Stderr Log Capture"
  - Principle II: Renamed from "Multi-Backend Export" to "OTEL Log Export"
  - Principle III: Kept (Non-Intrusive & Fault-Tolerant) — updated for stderr context
  - Principle IV: Simplified (Privacy by Default) — log lines may contain sensitive data, truncation enforced
  - Principle V: Kept (Zero-Config Bootstrap) — simplified
  - Principle VI: Kept (Version-First Changes)

Removed sections:
  - All trace/span references
  - Hook-based event architecture
  - Multi-backend fan-out
  - Context propagation

Added sections:
  - Stderr interception mechanism
  - Log line parsing

Templates requiring updates:
  - README.md — full rewrite
  - CLAUDE.md — full rewrite
  - All source code — full rewrite (most files deleted)

Follow-up TODOs:
  - Implement new architecture in feature branch
  - Remove all trace-related source code
  - Remove trace-related dependencies
-->

# opencode-otel Constitution

## Mission

**opencode-otel** is an OpenCode plugin that captures runtime stderr logs and forwards them as OpenTelemetry LogRecords to an OTLP-compatible log collector (e.g., company TripLog collector via gRPC).

Business-level observability (session traces, message spans, tool call spans) is handled by a separate plugin (opencode-plugin-langfuse). This plugin's sole responsibility is **runtime log shipping**.

## Core Principles

### I. Stderr Log Capture

The plugin intercepts OpenCode's runtime log output by monkey-patching `process.stderr.write` at plugin initialization time. This is the JS/TS equivalent of Java's dynamic proxy — a runtime interception without modifying the host application's source code.

How it works:
- OpenCode's internal `Logger` (src/util/log.ts) writes all log output via a `write` function that defaults to `process.stderr.write`
- The plugin replaces `process.stderr.write` with a wrapper that:
  1. Forwards the original data to the real stderr (preserving normal log output)
  2. Converts each log line into an OTEL LogRecord
  3. Emits the LogRecord to the configured OTEL log exporter
- The interception is transparent — OpenCode and other plugins are unaffected

Key constraints:
- MUST NOT suppress or alter the original stderr output
- MUST NOT cause infinite recursion (the plugin's own error logging must bypass the interceptor)
- MUST handle partial writes and multi-line chunks correctly

### II. OTEL Log Export

All captured log lines are exported as standard OTEL LogRecords via the OpenTelemetry SDK:
- **Protocol**: gRPC (primary, for company TripLog collector) or HTTP/JSON (fallback)
- **Format**: Each stderr line → one OTEL LogRecord with parsed severity, timestamp, and body
- **Batching**: `BatchLogRecordProcessor` for efficient export (configurable interval and queue size)
- **Resource attributes**: Auto-detected from `OTEL_RESOURCE_ATTRIBUTES` environment variable

No trace export, no span creation, no context propagation. Log-only.

### III. Non-Intrusive & Fault-Tolerant

The plugin MUST NEVER affect OpenCode core functionality:
- The stderr write wrapper MUST always call the original write (even if OTEL export fails)
- Export failures are silent — SDK retries then drops, no user-visible impact
- Plugin initialization failure results in graceful degradation (no interception installed, stderr works normally)
- The interceptor MUST NOT add measurable latency to stderr writes (fire-and-forget pattern)

### IV. Privacy-Aware Log Forwarding

Runtime logs may contain sensitive information. The plugin applies these safeguards:
- All log line bodies are truncated to a configurable maximum length (default: 4096 characters)
- The plugin does NOT parse or filter log content — it forwards raw lines as-is
- Sensitive data filtering is the responsibility of the log collector / backend, not this plugin
- The plugin MUST NOT log intercepted content to its own diagnostics (avoid echo loops)

### V. Zero-Config Bootstrap

The plugin MUST work out-of-box with minimal configuration:
- Auto-read standard `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` and `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL` environment variables
- Auto-read `OTEL_RESOURCE_ATTRIBUTES` for resource metadata (service.name, idc, bu.code, etc.)
- Auto-read `OTEL_SERVICE_NAME` for service identification
- Sensible defaults: gRPC protocol, 5s batch interval, 2048 queue size

### VI. Version-First Changes

Any code or configuration change MUST follow this sequence:
1. **Bump the version number first** — update `version` in `package.json` before making functional changes. Follow semver: MAJOR for breaking changes, MINOR for new features, PATCH for bug fixes.
2. **Implement the change** — make the functional modifications.
3. **Update README.md immediately** — every code change that affects user-facing behavior, configuration, or log format MUST include a corresponding README.md update in the same commit or PR.

## Technical Constraints

### Runtime
- **Bun** (TypeScript/JavaScript) — plugin runs in the same process as OpenCode
- **Monkey-patch `process.stderr.write`** — runtime interception of log output
- **gRPC via `@grpc/grpc-js`** — pure JS, 95% Bun compat for unary calls

### Plugin Model
- OpenCode npm plugin (`@opencode-ai/plugin` interface)
- No hooks used (no event, no chat.message, no tool.execute)
- Plugin returns empty hooks object `{}`
- All work happens via the stderr interceptor installed at init time
- Distribution: npm public registry as `opencode-otel`

### Dependencies (minimal)
- `@opentelemetry/api-logs` — OTEL Logs API
- `@opentelemetry/sdk-logs` — LoggerProvider, BatchLogRecordProcessor
- `@opentelemetry/exporter-logs-otlp-grpc` — gRPC log export
- `@opentelemetry/exporter-logs-otlp-http` — HTTP log export (fallback)
- `@opentelemetry/resources` — resource attributes + envDetector
- `@grpc/grpc-js` (transitive) — pure JS gRPC client

NOT needed (removed from previous architecture):
- `@opentelemetry/api` — no tracing
- `@opentelemetry/sdk-trace-base` — no spans
- `@opentelemetry/exporter-trace-otlp-*` — no trace export

### Build
- tsup (ESM output, tree-shaking, DTS generation)
- External `@opencode-ai/plugin` (provided by host runtime)
- Bundle OTEL deps (not provided by host)

## Architecture

```text
Plugin Entry (src/index.ts)
  ├─ Config (src/config.ts) ← env vars + optional config file
  ├─ Stderr Interceptor (src/interceptor.ts)
  │   ├─ Replaces process.stderr.write with wrapper
  │   ├─ Forwards original data to real stderr (transparent)
  │   └─ Emits each line as OTEL LogRecord
  ├─ Log Provider (src/provider.ts)
  │   ├─ LoggerProvider setup with resource attributes
  │   └─ BatchLogRecordProcessor → gRPC/HTTP exporter
  └─ Shutdown (src/shutdown.ts) ← graceful flush on process exit
```

## Log Line → OTEL LogRecord Mapping

| Source (stderr line) | OTEL LogRecord field |
|---------------------|---------------------|
| Full line text | `body` (truncated to max length) |
| Parsed severity prefix (ERROR/WARN/INFO/DEBUG) | `severityNumber` + `severityText` |
| Current timestamp | `observedTimestamp` |
| `OTEL_RESOURCE_ATTRIBUTES` | Resource attributes |
| `OTEL_SERVICE_NAME` | `service.name` resource attribute |

## Quality Standards

### Code
- Files < 200 lines, functions < 50 lines
- Strict TypeScript (`strict: true`)
- No mutation — immutable patterns for all data transformations
- No `console.log` / `console.error` in the interceptor path (avoid recursion)

### Testing
- Unit tests: verify interceptor captures stderr writes and restores original
- Unit tests: verify log line parsing (severity extraction)
- Unit tests: verify LogRecord creation with correct attributes
- Target 80%+ coverage

### Performance
- Stderr write latency overhead: < 1ms (fire-and-forget, no await)
- Batch export every 5s (configurable)
- Max queue size 2048 (configurable)
- Graceful shutdown with 5s flush timeout

## Governance

Constitution supersedes all other practices. Amendments require:
1. Documentation of rationale
2. Impact analysis on log forwarding behavior
3. Backward compatibility assessment (config format, env var names)

**Version**: 2.0.0 | **Ratified**: 2026-03-27 | **Last Amended**: 2026-03-27
