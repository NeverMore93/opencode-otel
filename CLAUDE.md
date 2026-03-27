# CLAUDE.md

## What This Project Is

**opencode-otel** — an OpenCode npm plugin that forwards runtime stderr logs to any OTLP-compatible log collector via gRPC or HTTP. Business events (traces/spans) are handled by opencode-plugin-langfuse.

## Technical Context

- **Language**: TypeScript 5.5+ / Bun runtime
- **Project Type**: npm library (OpenCode plugin)
- **Dependencies**: `@opentelemetry/api-logs`, `@opentelemetry/sdk-logs`, `@opentelemetry/exporter-logs-otlp-grpc`, `@opentelemetry/exporter-logs-otlp-http`, `@opentelemetry/resources`, `@grpc/grpc-js` (transitive)
- **Plugin SDK**: `@opencode-ai/plugin@>=1.1.0` (peer dependency)
- **Build**: tsup (ESM output, external `@opencode-ai/*`)
- **Testing**: `bun test`

## Key Constraints

- **Cannot modify OpenCode source code** — integration via npm plugin mechanism only
- **Monkey-patch `process.stderr.write`** — runtime interception of log output (JS dynamic proxy pattern)
- **gRPC primary, HTTP fallback** — company TripLog collector only accepts gRPC on :8080
- **No hooks used** — plugin returns empty `{}`, all work via stderr interceptor
- **No traces/spans** — business events handled by opencode-plugin-langfuse

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
| `OTEL_RESOURCE_ATTRIBUTES` | — | Additional resource attributes (auto-parsed by SDK) |

## Design Documents

All specs are in `specs/` directory:
- `constitution.md` — project constitution and principles
- Feature specs in `specs/010-stderr-log-forwarder/`
