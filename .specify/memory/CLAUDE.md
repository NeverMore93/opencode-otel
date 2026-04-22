# .specify/memory

## Role
- Owns generated spec-kit memory and long-lived planning context.

## Owns
- `constitution.md` and other machine-maintained memory inputs.
- Context snapshots consumed by spec-kit update scripts.

## Avoid
- Treat files here as tooling state, not product docs.
- Do not store runtime source rules here when they belong in repo-level instructions.
