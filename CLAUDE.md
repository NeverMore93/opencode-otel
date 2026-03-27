# CLAUDE.md

## What This Project Is

**opencode-otel** — an OpenCode npm plugin that forwards runtime stderr logs to any OTLP-compatible log collector via gRPC or HTTP. Business events (traces/spans) are handled by opencode-plugin-langfuse.

## Technical Context

- **Language**: TypeScript 5.5+ / Bun runtime
- **Project Type**: npm library (OpenCode plugin)
- **Dependencies**: `@opentelemetry/api`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/exporter-trace-otlp-grpc`, `@opentelemetry/api-logs`, `@opentelemetry/sdk-logs`, `@opentelemetry/exporter-logs-otlp-grpc`, `@opentelemetry/exporter-logs-otlp-http`, `@opentelemetry/resources`, `@grpc/grpc-js` (transitive)
- **Plugin SDK**: `@opencode-ai/plugin@>=1.1.0` (peer dependency)
- **Build**: tsup (ESM output, external `@opencode-ai/*`)
- **Testing**: `bun test`

## Key Constraints

- **Cannot modify OpenCode source code** — integration via npm plugin mechanism only
- **Monkey-patch `process.stderr.write`** — runtime interception of log output (JS dynamic proxy pattern)
- **gRPC primary, HTTP fallback** — company TripLog collector only accepts gRPC on :8080
- **Uses `event` hook for session lifecycle tracking** (`session.created`/`idle`/`deleted`) — creates root spans per session so all logs share the same traceId
- **No business traces/spans** — business events handled by opencode-plugin-langfuse

## Architecture

```text
Plugin Entry (src/index.ts)
  ├─ Config (src/config.ts) ← env vars + optional config file
  ├─ Log Provider (src/provider.ts) ← LoggerProvider + BatchLogRecordProcessor + gRPC/HTTP exporter
  ├─ Interceptor (src/interceptor.ts) ← monkey-patch process.stderr.write, line buffering, severity parsing
  └─ Shutdown (src/shutdown.ts) ← graceful flush on process exit
```

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | — | Log collector endpoint (required) |
| `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL` | `grpc` | Protocol: `grpc` or `http/json` |
| `OTEL_SERVICE_NAME` | `opencode-agent` | service.name resource attribute |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | — | Traces endpoint (optional, for session span export) |
| `OTEL_RESOURCE_ATTRIBUTES` | — | Additional resource attributes (auto-parsed by SDK) |

## Design Documents

All specs are in `specs/` directory:
- `constitution.md` — project constitution and principles
- Feature specs in `specs/010-stderr-log-forwarder/`
