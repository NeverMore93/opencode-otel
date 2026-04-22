# .claude

## Role
- Owns Claude-specific repo automation, commands, and local assistant state.

## Owns
- Slash-command definitions in `commands/`.
- Claude-local workflow assets that do not ship in the npm package.

## Avoid
- Do not place runtime plugin code here.
- Do not make product behavior depend on local worktree or cache content.
