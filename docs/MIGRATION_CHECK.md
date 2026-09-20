# Source-agent migration checks

Use `check --from` when a repository contains conventions for more than one coding agent and you want migration findings scoped to the agent you are leaving:

```bash
node src/cli.js check . --from claude-code --agent codex
node src/cli.js check . --from claude-code --agent codex --format json
node src/cli.js check . --from claude-code --agent codex --format sarif --output caniagent.sarif
```

Without `--from`, `check` keeps its existing behavior and evaluates every compatibility-relevant surface it detects.

With `--from <agent-id>`, CanIAgent first keeps only detected files whose convention is native to that source agent, then evaluates those detections against the target supplied by `--agent`. This avoids unrelated files for other agents becoming migration noise in mixed-agent repositories. Shared conventions remain in scope when the source agent is one of their native agents.

The JSON report includes a `source` agent object when migration mode is active (`null` otherwise). SARIF contains the same scoped findings as text/JSON output. `--from` must name a known agent and must differ from `--agent`.

This is a scanner filter, not a compatibility claim or an automatic translator. It does not rewrite files, infer undocumented support, or change `data/matrix.json`.
