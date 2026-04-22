# src

## Role
- Owns the shipped plugin runtime and OTEL integration logic.

## Owns
- Plugin entry, config parsing, exporter/provider wiring, stderr interception, session state, and shutdown flow.

## Boundaries
- Keep `index.ts` orchestration-only.
- Keep config parsing in `config.ts`, transport wiring in `provider.ts`, and stderr interception in `interceptor.ts`.

## Avoid
- Do not place tests, workflow automation, or planning artifacts here.
- Do not let one module absorb another module's responsibility just to avoid a new file.
