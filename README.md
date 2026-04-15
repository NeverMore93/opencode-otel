# opencode-otel

[![npm](https://img.shields.io/npm/v/opencode-otel)](https://www.npmjs.com/package/opencode-otel)

[OpenCode](https://opencode.ai) plugin that forwards runtime stderr logs to any OTLP-compatible collector via gRPC or HTTP.

For BAT deployments, the plugin follows the same OpenTelemetry environment-variable contract injected by Captain:
- logs route to `triplog-otel-collector`
- optional session-correlation traces route to `bat-otel-collector`
- metrics remain outside this plugin and are ignored safely

Business-level observability (session traces, message spans, tool calls) is still handled by [opencode-plugin-langfuse](https://github.com/NeverMore93/opencode-plugin-langfuse). This plugin focuses on runtime log shipping and log-to-session correlation only.

## How It Works

The plugin monkey-patches `process.stderr.write` at initialization. Each complete stderr line is:

1. parsed for severity (`ERROR`, `WARN`, `INFO`, `DEBUG`)
2. emitted as an OTEL `LogRecord`
3. batched to the configured OTLP log exporter

Original stderr output is preserved exactly as-is.

## Quick Start

### 1. Enable the plugin in OpenCode

Add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-otel"]
}
```

### 2. Set OTLP routing

Generic OTLP example:

```bash
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://your-collector:8080
export OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=grpc
```

### 3. Start OpenCode

```bash
opencode
```

## BAT / Captain Example

The plugin accepts the BAT endpoint format verbatim: `http://host:8080` with protocol declared separately as `grpc`.

```bash
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://bat-otel-collector.fws.qa.nt.ctripcorp.com:8080
export OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=grpc
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://triplog-otel-collector.fws.qa.nt.ctripcorp.com:8080
export OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=grpc
export OTEL_EXPORTER_OTLP_TIMEOUT=2000
export OTEL_TRACES_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_METRICS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://otel.hickwall.sys.qa.nt.ctripcorp.com:8080
export OTEL_EXPORTER_OTLP_METRICS_PROTOCOL=grpc
export OTEL_RESOURCE_ATTRIBUTES=service.name=100059443,group.id=71236405,idc=NTGXH,bu.code=BBZ,cloud.availability_zone=NTGXH-AZ1,cloud.region=NT,host.ip=10.1.2.3,host.name=pod-001
export OTEL_SERVICE_NAME=pay-dev-agent
```

Notes:
- `OTEL_RESOURCE_ATTRIBUTES.service.name` wins over `OTEL_SERVICE_NAME`
- missing BAT identity keys are backfilled from runtime metadata when available
- metrics exporter env vars are tolerated but ignored by this plugin

## Signal Routing

| Signal | Source | Route | Required |
|--------|--------|-------|----------|
| Logs | `OTEL_EXPORTER_OTLP_LOGS_*` | TripLog / generic OTLP collector | Yes |
| Traces | `OTEL_EXPORTER_OTLP_TRACES_*` | BAT trace collector / generic OTLP trace collector | No |
| Metrics | shared Captain OTEL template | ignored by this plugin | No |

If no logs endpoint is configured, the plugin remains inactive and does not install the stderr interceptor.

## Service Identity Precedence

`service.name` is resolved in this order:

1. `service.name` inside `OTEL_RESOURCE_ATTRIBUTES`
2. `OTEL_SERVICE_NAME`
3. `serviceName` in the optional `otel.json`
4. `PAAS_APP_APPID`
5. built-in default `opencode-agent`

Other BAT identity fields are resolved as:

| Resource attribute | Primary source | Runtime fallback |
|--------------------|----------------|------------------|
| `group.id` | `OTEL_RESOURCE_ATTRIBUTES` | `PAAS_APP_GROUPID` |
| `idc` | `OTEL_RESOURCE_ATTRIBUTES` | `CDOS_IDC` |
| `bu.code` | `OTEL_RESOURCE_ATTRIBUTES` | `CDOS_BUCODE` |
| `cloud.availability_zone` | `OTEL_RESOURCE_ATTRIBUTES` | `CDOS_AZ` |
| `cloud.region` | `OTEL_RESOURCE_ATTRIBUTES` | `CDOS_REGION` |
| `host.ip` | `OTEL_RESOURCE_ATTRIBUTES` | `CDOS_POD_IP` |
| `host.name` | `OTEL_RESOURCE_ATTRIBUTES` | `HOSTNAME` or OS hostname |

When inputs disagree, the higher-priority source wins and the plugin emits a startup warning through the OpenCode app logger.

## Configuration

| Env Variable | Required | Default | Description |
|-------------|:--------:|---------|-------------|
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | **Yes** | — | OTLP logs endpoint |
| `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL` | No | `grpc` | Logs protocol: `grpc` or `http/json` |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | No | — | Optional session-correlation trace endpoint |
| `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` | No | `grpc` | Trace protocol; only `grpc` is supported |
| `OTEL_EXPORTER_OTLP_TIMEOUT` | No | SDK default | Shared OTLP timeout in milliseconds |
| `OTEL_SERVICE_NAME` | No | `opencode-agent` | Secondary service-name input |
| `OTEL_RESOURCE_ATTRIBUTES` | No | — | Explicit resource attributes and BAT identity source |
| `OTEL_EXPORTER_OTLP_HEADERS` | No | — | Comma-separated `key=value` auth headers |
| `OTEL_METRICS_EXPORTER` | No | ignored | Accepted for shared templates; not used |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | No | ignored | Accepted for shared templates; not used |
| `OTEL_EXPORTER_OTLP_METRICS_PROTOCOL` | No | ignored | Accepted for shared templates; not used |

### Optional Config File

Create `~/.config/opencode/plugins/otel.json`:

```json
{
  "logsEndpoint": "http://triplog-otel-collector.fws.qa.nt.ctripcorp.com:8080",
  "logsProtocol": "grpc",
  "tracesEndpoint": "http://bat-otel-collector.fws.qa.nt.ctripcorp.com:8080",
  "serviceName": "opencode-agent",
  "timeoutMs": 2000,
  "maxLineLength": 4096
}
```

Environment variables take precedence over the config file.

Set `OTEL_PLUGIN_CONFIG_PATH` to an absolute path to override the default config file location (useful for multi-tenant deployments or tests).

## Log Severity Mapping

| Stderr Prefix | OTEL Severity |
|---------------|:-------------:|
| `ERROR` | ERROR (17) |
| `WARN` | WARN (13) |
| `INFO` | INFO (9) |
| `DEBUG` | DEBUG (5) |
| Other | UNSPECIFIED (0) |

## Development

```bash
bun install
bun test
bun run build
```

## License

MIT
