# opencode-otel

[![npm](https://img.shields.io/npm/v/opencode-otel)](https://www.npmjs.com/package/opencode-otel)

OpenCode observability plugin — export session traces and logs via OpenTelemetry to any OTLP-compatible backend (Jaeger, Grafana Tempo, Datadog, LangSmith, Langfuse via OTLP, etc.).

## Quick Start

### 1. Configure OpenCode to Load the Plugin

Add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-otel"]
}
```

### 2. Set Backend Endpoints

**Generic OTLP** (Jaeger, Grafana Tempo, Langfuse, etc.):

```bash
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://localhost:4318/v1/logs
```

### 3. Start OpenCode

```bash
opencode
```

The plugin auto-initializes and begins exporting traces.

## Configuration

All configuration via environment variables (or optional `~/.config/opencode/plugins/otel.json`):

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

At least one OTLP endpoint must be configured for the plugin to activate.

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
  }
}
```

Environment variables always take precedence over config file values.

### Multi-Backend Support

Configure any OTLP-compatible backend by setting the appropriate endpoint and headers. Multiple backends can receive traces by routing through an OTLP collector (such as the OpenTelemetry Collector) that fans out to multiple destinations.

```text
TracerProvider
  └─ BatchSpanProcessor     → Generic OTLP HTTP endpoint
```

## Trace Structure

```
session (root span)
│  Resource: opencode.directory, opencode.project
│  Attributes: opencode.session.id, opencode.session.* (custom metadata)
├── chat.message (child span) — agent, model.provider, model.id, message.id, message.variant
├── tool.bash (child span) — tool.name, tool.call.id, tool.metadata.*
├── tool.read (child span) — tool.name, tool.call.id, tool.metadata.*
└── ... more tool spans
```

### Automatic Attribute Forwarding

Custom metadata passed when creating OpenCode sessions is automatically forwarded to trace attributes — no configuration needed:

| Level | Attributes | Source |
|-------|-----------|--------|
| Resource (all spans) | `opencode.directory`, `opencode.project` | Plugin context |
| Session root span | `opencode.session.*` | `session.created` event info |
| Message spans | `opencode.message.id`, `opencode.message.variant` | `chat.message` hook |
| Tool spans | `opencode.tool.metadata.*` | `tool.execute.after` hook |
| Log records | `opencode.event.*` | Event properties |

Only safe string/number/boolean values are forwarded. Objects, arrays, and empty strings are skipped. All values truncated to 256 characters.

## Event Log Records

Session events are emitted as OTEL log records with severity mapping:

| Event Pattern | Severity |
|---------------|----------|
| `session.error` | ERROR |
| `permission.*` | WARN |
| All others | INFO |

High-frequency events (`message.part.updated`) are filtered out by default.

## Features

- **Multi-backend support** — send traces to any OTLP-compatible backend
- **Full trace hierarchy** — session → message → tool call spans with correct parent-child relationships
- **Structured log records** — all session events with severity mapping
- **Privacy by default** — no message text, file contents, or credentials captured
- **Graceful degradation** — plugin errors never affect OpenCode
- **Zero-config bootstrap** — reads standard `OTEL_EXPORTER_OTLP_*` env vars
- **Bun-compatible** — works around Bun's broken AsyncLocalStorage with explicit context map

## Development

```bash
bun install             # Install dependencies
bun test                # Run 137+ tests
bun test --coverage     # 97%+ coverage
bun run build           # ESM bundle → dist/
```

## License

MIT
