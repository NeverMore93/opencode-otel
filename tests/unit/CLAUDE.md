# tests/unit

## Role
- Owns fast, deterministic unit tests for modules under `src/`.

## Owns
- Module-level behavior checks for config parsing, interception, provider setup, and session-safe changes.

## Avoid
- Do not turn these tests into integration or e2e suites.
- Prefer direct behavior assertions over duplicating implementation details.
