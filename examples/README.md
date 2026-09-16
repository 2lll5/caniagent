# Examples

Try the scanner against this repository itself:

```bash
node ../src/cli.js check .. --agent codex
node ../src/cli.js check .. --agent claude-code
```

CanIAgent intentionally detects multiple conventions in its own repo (`AGENTS.md` plus its own tooling) so contributors can exercise migration findings without a separate fixture checkout.
