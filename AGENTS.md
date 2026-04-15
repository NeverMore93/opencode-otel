# AGENTS.md

## What This Project Is

**opencode-otel** — an OpenCode npm plugin that forwards runtime stderr logs to any OTLP-compatible log collector via gRPC or HTTP. Business-level observability (session traces, tool calls) is handled separately by opencode-plugin-langfuse; this plugin only ships runtime logs and correlates them to sessions via traceId.

## Commands

```bash
bun install          # install deps (uses bun.lock)
bun test             # run all unit tests
bun run build        # tsup → dist/index.js (ESM + .d.ts)
```

There is no linter, formatter, or typecheck script configured. The build command is the only verification beyond tests. `prepublishOnly` runs the build automatically.

## Tech Stack

- **TypeScript 5.5+** on **Bun** runtime — not Node
- **tsup** builds ESM only; configured inline in `package.json` (no tsup.config file)
- `@opencode-ai/plugin@>=1.1.0` is a **peer dependency** — must be external in builds
- `tsconfig.json` uses `"noEmit": true` with strict mode; the build is handled entirely by tsup
- No `.eslintrc`, `.prettierrc`, or `biome.json` exists

## Architecture

```text
src/index.ts        ← plugin entry, orchestration only (returns {event} hook)
src/config.ts       ← env vars > otel.json config file > defaults
src/provider.ts     ← LoggerProvider (gRPC or HTTP) + BasicTracerProvider (gRPC only)
src/interceptor.ts  ← monkey-patch process.stderr.write, line buffering, severity parsing
src/session.ts      ← Map<sessionId, Span> for log-to-session trace correlation
src/shutdown.ts     ← graceful flush on beforeExit/SIGTERM/SIGINT
src/version.ts      ← reads version from package.json at runtime (never hard-coded)
```

## Key Constraints

- **Cannot modify OpenCode source** — integration via npm plugin `event` hook only
- **Monkey-patch `process.stderr.write`** — interceptor has a recursion guard (`inEmit` flag); if emit callback writes to stderr it is silently skipped
- **Session tracking uses a module-level Map, not AsyncLocalStorage** — Bun's AsyncLocalStorage is broken; `session.ts` tracks active session via a plain variable
- **Trace exporter only supports gRPC** — if a non-gRPC traces protocol is configured, trace export is disabled with a warning
- **Plugin goes inactive silently** if `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` is not set (no interceptor installed)

## Config Precedence

For most settings: **env var → otel.json config file → default**

`service.name` has a deeper chain: `OTEL_SERVICE_NAME` → `OTEL_RESOURCE_ATTRIBUTES[service.name]` → `otel.json serviceName` → `PAAS_APP_APPID` → `"opencode-agent"`

Config file default path: `~/.config/opencode/plugins/otel.json` (override with `OTEL_PLUGIN_CONFIG_PATH`). The config file supports `${ENV_VAR}` placeholders.

## Testing

- Tests live in `tests/unit/` — three files covering config, provider, and interceptor
- Tests manipulate `process.env` directly; they run in Bun's test runner (`bun test`)
- Provider tests validate the candidate-based resource attribute resolution and BAT runtime metadata backfilling
- No integration tests, no test services, no fixtures needed

## CI / Publishing

- **publish.yml**: triggered by `v*` tags → `bun install` → `bun test` → `bun run build` → `npm publish` (requires `NPM_TOKEN` secret)
- Two Claude Code review workflows exist for PR automation (read-only)

## Specs

Design documents are in `specs/`. Key references:
- `specs/constitution.md` — project principles
- `specs/010-stderr-log-forwarder/` — current feature spec
- `specs/011-align-bat-otel/` — BAT OTEL alignment spec
- Directory-level `CLAUDE.md` files throughout the repo define ownership boundaries for Claude Code sessions
