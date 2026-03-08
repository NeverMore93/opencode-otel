# opencode-otel

OpenCode plugin for unified observability via OpenTelemetry — export session traces and logs to any OTLP-compatible backend (Jaeger, Grafana Tempo, Datadog, etc.).

## Features

- Session lifecycle tracking (created → idle/deleted) as root spans
- Chat message spans with agent/model attributes
- Tool execution spans with timing and status
- Event log records with severity mapping
- Privacy by default — no message text, file contents, or credentials captured
- Graceful degradation — plugin errors never affect OpenCode

## Installation

Add to your OpenCode config (`.opencode/opencode.json`):

```json
{
  "experimental": { "openTelemetry": true },
  "plugin": ["opencode-otel@0.1.1"]
}
```

## Configuration

Set environment variables for your OTEL backend:

```bash
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://localhost:4318/v1/logs
export OTEL_SERVICE_NAME=opencode-agent  # optional, default: opencode-agent
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer token"  # optional
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

## Development

```bash
bun install
bun test           # 107 tests
bun test --coverage # 97%+ coverage
bun run build      # ESM bundle → dist/
```

## Runtime

Bun v1.3.9+ (TypeScript)

## License

MIT
