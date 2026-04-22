# .specify/scripts

## Role
- Owns automation entrypoints that bootstrap and update spec-kit artifacts.

## Owns
- Shell-specific implementations in child folders.
- Cross-script orchestration boundaries and invocation contracts.

## Avoid
- Do not add product runtime logic here.
- Keep script behavior aligned with templates and generated-context expectations.
