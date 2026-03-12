# opencode-otel

[![npm](https://img.shields.io/npm/v/opencode-otel)](https://www.npmjs.com/package/opencode-otel)

[OpenCode](https://opencode.ai) observability plugin — export session traces and logs to any OTLP-compatible backend (Jaeger, Grafana Tempo, Datadog, etc.) via OpenTelemetry.

## Quick Start

### 1. Configure OpenCode to Load the Plugin

Add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-otel"]
}
```

### 2. Set OTEL Backend Endpoints

```bash
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://localhost:4318/v1/logs
```

### 3. Start OpenCode

```bash
opencode
```

The plugin auto-initializes and begins exporting traces and logs.

## Configuration

All configuration via environment variables (or optional `.opencode/plugins/otel.json`):

| Env Variable | Required | Default | Description |
|-------------|:--------:|---------|-------------|
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | No | — | OTLP HTTP endpoint for traces |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | No | — | OTLP HTTP endpoint for logs |
| `OTEL_SERVICE_NAME` | No | `opencode-agent` | `service.name` resource attribute |
| `OTEL_EXPORTER_OTLP_HEADERS` | No | — | Comma-separated `key=value` headers |

At least one endpoint must be set for the plugin to activate. If neither is configured, the plugin stays inactive (no overhead).

### Config File

Instead of (or in addition to) env vars, create `.opencode/plugins/otel.json`. An example is provided at the repo root — copy and edit:

```bash
cp otel.json.example .opencode/plugins/otel.json
```

The example file covers all supported fields including Langfuse credentials and `${VAR}` placeholder syntax for env var resolution:

```json
{
  "tracesEndpoint": "http://localhost:4318/v1/traces",
  "logsEndpoint": "http://localhost:4318/v1/logs",
  "serviceName": "opencode-agent",
  "headers": {
    "Authorization": "Bearer ${YOUR_API_TOKEN}"
  },
  "langfuse": {
    "publicKey": "${LANGFUSE_PUBLIC_KEY}",
    "secretKey": "${LANGFUSE_SECRET_KEY}",
    "baseUrl": "https://your-langfuse-host.example.com"
  }
}
```

Environment variables always take precedence over config file values.

## Trace Structure

```
session (root span)
├── chat.message (child span) — agent, model.provider, model.id
├── tool.bash (child span) — tool.name, tool.call.id
├── tool.read (child span) — tool.name, tool.call.id
└── ... more tool spans
```

## Event Log Records

Session events are emitted as OTEL log records with severity mapping:

| Event Pattern | Severity |
|---------------|----------|
| `session.error` | ERROR |
| `permission.*` | WARN |
| All others | INFO |

High-frequency events (`message.part.updated`) are filtered out by default.

## Features

- **Full trace hierarchy** — session → message → tool call spans with correct parent-child relationships
- **Structured log records** — all session events with severity mapping
- **Privacy by default** — no message text, file contents, or credentials captured
- **Graceful degradation** — plugin errors never affect OpenCode
- **Zero-config bootstrap** — reads standard `OTEL_EXPORTER_OTLP_*` env vars
- **Bun-compatible** — works around Bun's broken AsyncLocalStorage with explicit context map

## Development

```bash
bun install             # Install dependencies
bun test                # Run 107 tests
bun test --coverage     # 97%+ coverage
bun run build           # ESM bundle → dist/
```

## License

MIT
