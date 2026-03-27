# opencode-otel

[![npm](https://img.shields.io/npm/v/opencode-otel)](https://www.npmjs.com/package/opencode-otel)

[OpenCode](https://opencode.ai) plugin — forwards runtime stderr logs to any OTLP-compatible log collector via gRPC or HTTP.

Business-level observability (session traces, message spans, tool calls) is handled separately by [opencode-plugin-langfuse](https://github.com/NeverMore93/opencode-plugin-langfuse). This plugin focuses exclusively on **runtime log shipping**.

## How It Works

The plugin monkey-patches `process.stderr.write` at initialization to intercept all runtime log output. Each complete log line is:

1. Parsed for severity (ERROR/WARN/INFO/DEBUG prefix)
2. Converted to an OTEL LogRecord
3. Batched and exported to the configured OTLP log collector

The original stderr output is always preserved — the interception is fully transparent.

## Quick Start

### 1. Configure OpenCode

Add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-otel"]
}
```

### 2. Set Log Endpoint

```bash
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://your-collector:8080
export OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=grpc
```

### 3. Start OpenCode

```bash
opencode
```

All runtime logs are now forwarded to your collector.

## Configuration

| Env Variable | Required | Default | Description |
|-------------|:--------:|---------|-------------|
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | **Yes** | — | OTLP log collector endpoint |
| `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL` | No | `grpc` | Protocol: `grpc` or `http/json` |
| `OTEL_SERVICE_NAME` | No | `opencode-agent` | `service.name` resource attribute |
| `OTEL_EXPORTER_OTLP_HEADERS` | No | — | Comma-separated `key=value` auth headers |
| `OTEL_RESOURCE_ATTRIBUTES` | No | — | Additional resource attributes (auto-parsed) |

### Config File (optional)

Create `~/.config/opencode/plugins/otel.json`:

```json
{
  "logsEndpoint": "http://your-collector:8080",
  "logsProtocol": "grpc",
  "serviceName": "opencode-agent",
  "maxLineLength": 4096
}
```

Environment variables take precedence over config file values.

## Log Severity Mapping

| Stderr Prefix | OTEL Severity |
|---------------|:-------------:|
| `ERROR` | ERROR (17) |
| `WARN` | WARN (13) |
| `INFO` | INFO (9) |
| `DEBUG` | DEBUG (5) |
| Other | UNSPECIFIED (0) |

## Features

- **Transparent interception** — stderr output preserved exactly as-is
- **gRPC + HTTP** — dual protocol support for any OTLP-compatible collector
- **Severity parsing** — automatic log level detection from line prefix
- **Line buffering** — handles partial writes correctly
- **Fire-and-forget** — zero latency impact on stderr writes
- **Graceful shutdown** — flushes pending records on process exit
- **Resource attributes** — auto-reads `OTEL_RESOURCE_ATTRIBUTES` for metadata

## Development

```bash
bun install             # Install dependencies
bun test                # Run tests
bun run build           # ESM bundle → dist/
```

## License

MIT
