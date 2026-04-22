# tests

## Role
- Owns automated verification for the plugin.

## Owns
- Test organization, fixtures, and shared testing conventions.
- Fast unit coverage in `unit/`.

## Avoid
- Do not duplicate production logic in tests.
- Keep flaky timing, network access, and external collector dependencies out of this tree.
