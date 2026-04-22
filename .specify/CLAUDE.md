# .specify

## Role
- Owns spec-kit scaffolding, templates, memory, and helper scripts for planning workflows.

## Owns
- Generated planning context in `memory/`.
- Bootstrap scripts in `scripts/`.
- Reusable artifact templates in `templates/`.

## Avoid
- Do not couple runtime plugin behavior to files here.
- Root `CLAUDE.md` is managed by `scripts/powershell/update-agent-context.ps1`; treat it as generated context.
