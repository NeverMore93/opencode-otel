# CLAUDE.md

## What This Project Is

**opencode-otel** — an OpenCode npm plugin that provides unified observability by exporting session traces and logs to any OTLP-compatible backend (Langfuse, LangSmith, Jaeger, Grafana Tempo, etc.) via OpenTelemetry.

## Technical Context

- **Language**: TypeScript 5.5+ / Bun runtime
- **Project Type**: npm library (OpenCode plugin)
- **Dependencies**: `@langfuse/otel@5.x` (LangfuseSpanProcessor), `@opentelemetry/api@1.9.x`, `@opentelemetry/sdk-trace-base@2.5.x`, `@opentelemetry/sdk-logs@0.212.x`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/exporter-logs-otlp-http`, `@opentelemetry/resources@2.5.x`
- **Plugin SDK**: `@opencode-ai/plugin@>=1.1.0` (peer dependency)
- **Build**: tsup (ESM output, external `@opencode-ai/*`)
- **Testing**: `bun test` with `InMemorySpanExporter`

## Key Constraints

- **Cannot modify OpenCode source code** — integration must be via npm plugin mechanism only
- **Bun AsyncLocalStorage is broken** — use explicit `Map<sessionID, Context>` for span context propagation, never `context.with()`
- **OTEL JS Logs SDK is experimental** (0.212.x) — may have breaking changes
- **OTLP HTTP only** — no gRPC (Bun doesn't support `@grpc/grpc-js` native modules)
- **Data sensitivity** — never include message text, file contents, tool output, or credentials in spans/logs

## Attribute Forwarding

Properties from OpenCode are automatically forwarded to spans at three levels:

1. **Resource attributes** (all spans): `opencode.directory`, `opencode.project` — from plugin context
2. **Root span attributes** (per session): `opencode.session.*` — from `session.created` event's `properties.info` (all safe string/number fields)
3. **Span attributes** (per hook): `opencode.message.id`, `opencode.message.variant`, `opencode.tool.metadata.*` — from dedicated hook inputs
4. **LogRecord attributes** (per event): `opencode.event.*` — safe string/number fields from event properties

No additional configuration needed — custom metadata passed via OpenCode API session creation appears automatically in Langfuse traces.

## Architecture

```
Plugin Entry (src/index.ts)
  ├─ Config (src/config.ts) ← env vars + ~/.config/opencode/plugins/otel.json
  ├─ Telemetry
  │   ├─ provider.ts   ← TracerProvider + LoggerProvider setup (+ pluginContext → Resource)
  │   ├─ backends.ts   ← Backend processor factories (Langfuse SDK + Generic OTLP fan-out)
  │   ├─ context.ts    ← Session context map (Bun workaround)
  │   └─ shutdown.ts   ← Graceful shutdown
  └─ Hooks (source-aware: dedicated hooks = 'primary', event hook = 'fallback')
      ├─ event.ts         ← event hook → OTEL log records + session root spans + fallback message/tool spans + attribute forwarding
      ├─ chat-message.ts  ← chat.message → primary message child spans (+ messageID/variant)
      └─ tool-execute.ts  ← tool.execute.before/after → primary tool child spans (+ metadata forwarding)
```

## Backend Configuration

| Backend | Env Vars | Auth |
|---------|----------|------|
| Langfuse | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` | `@langfuse/otel` native SDK |
| Generic OTEL | `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | `OTEL_EXPORTER_OTLP_HEADERS` |

## Design Documents

All specs are in `specs/` directory:
- `constitution.md` — project constitution and principles
- `spec.md` — feature specification
- `plan.md` — implementation plan
- `tasks.md` — task list (needs regeneration)
- `research.md` — technology decisions
- `data-model.md` — entity definitions
- `contracts/` — plugin hooks and OTEL export contracts
