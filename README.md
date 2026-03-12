# opencode-otel

[![npm](https://img.shields.io/npm/v/opencode-otel)](https://www.npmjs.com/package/opencode-otel)

[OpenCode](https://opencode.ai) observability plugin — export session traces and logs via OpenTelemetry to generic OTLP backends (Jaeger, Grafana Tempo, Datadog, etc.), with native Langfuse support via `@langfuse/otel`.

## Quick Start

### 1. Configure OpenCode to Load the Plugin

Add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-otel"]
}
```

### 2. Set Backend Endpoints

**Langfuse** (recommended for LLM observability):

```bash
export LANGFUSE_PUBLIC_KEY="pk-lf-..."
export LANGFUSE_SECRET_KEY="sk-lf-..."
export LANGFUSE_BASE_URL="https://your-langfuse-host.example.com"
```

**Generic OTLP** (Jaeger, Grafana Tempo, etc.):

```bash
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://localhost:4318/v1/logs
```

**Fan-out** (both simultaneously):

Set both Langfuse credentials and generic OTLP endpoints. Traces are sent to all backends independently.

### 3. Start OpenCode

```bash
opencode
```

The plugin auto-initializes and begins exporting traces.

## Configuration

All configuration via environment variables (or optional `~/.config/opencode/plugins/otel.json`):

### Langfuse Backend

| Env Variable | Required | Description |
|-------------|:--------:|-------------|
| `LANGFUSE_PUBLIC_KEY` | Yes* | Langfuse project public key |
| `LANGFUSE_SECRET_KEY` | Yes* | Langfuse project secret key |
| `LANGFUSE_BASE_URL` | Yes* | Langfuse instance URL |

*All three required to activate Langfuse backend. Uses `@langfuse/otel` SDK (native API, not OTLP).

### Generic OTLP Backend

| Env Variable | Required | Default | Description |
|-------------|:--------:|---------|-------------|
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | No | — | OTLP HTTP endpoint for traces |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | No | — | OTLP HTTP endpoint for logs |
| `OTEL_EXPORTER_OTLP_HEADERS` | No | — | Comma-separated `key=value` headers |

### Common

| Env Variable | Required | Default | Description |
|-------------|:--------:|---------|-------------|
| `OTEL_SERVICE_NAME` | No | `opencode-agent` | `service.name` resource attribute |

At least one backend (Langfuse or generic OTLP) must be configured for the plugin to activate.

### Config File

Instead of (or in addition to) env vars, create `~/.config/opencode/plugins/otel.json`. An example is included in the npm package — copy and edit:

```bash
mkdir -p ~/.config/opencode/plugins && cp node_modules/opencode-otel/otel.json.example ~/.config/opencode/plugins/otel.json
```

The example file covers all supported fields including `${VAR}` placeholder syntax for env var resolution:

```json
{
  "serviceName": "my-agent",
  "tracesEndpoint": "http://localhost:4318/v1/traces",
  "logsEndpoint": "http://localhost:4318/v1/logs",
  "headers": {
    "Authorization": "Bearer ${YOUR_API_TOKEN}"
  },
  "langfuse": {
    "publicKey": "${LANGFUSE_PUBLIC_KEY}",
    "secretKey": "${LANGFUSE_SECRET_KEY}",
    "baseUrl": "${LANGFUSE_BASE_URL}"
  }
}
```

Environment variables always take precedence over config file values.

### Multi-Backend Fan-Out

When both Langfuse credentials and generic OTLP endpoints are configured, traces are sent to **all backends simultaneously**. Each backend operates independently — a failure in one does not affect the other.

```text
TracerProvider
  ├─ LangfuseSpanProcessor  → Langfuse native API
  └─ BatchSpanProcessor     → Generic OTLP HTTP endpoint
```

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

- **Langfuse native SDK** — uses `@langfuse/otel` `LangfuseSpanProcessor` for reliable Langfuse delivery
- **Multi-backend fan-out** — send traces to Langfuse and generic OTLP backends simultaneously
- **Full trace hierarchy** — session → message → tool call spans with correct parent-child relationships
- **Structured log records** — all session events with severity mapping
- **Privacy by default** — no message text, file contents, or credentials captured
- **Graceful degradation** — plugin errors never affect OpenCode
- **Zero-config bootstrap** — reads standard `OTEL_EXPORTER_OTLP_*` and `LANGFUSE_*` env vars
- **Bun-compatible** — works around Bun's broken AsyncLocalStorage with explicit context map

## Development

```bash
bun install             # Install dependencies
bun test                # Run 114 tests
bun test --coverage     # 97%+ coverage
bun run build           # ESM bundle → dist/
```

## License

MIT
