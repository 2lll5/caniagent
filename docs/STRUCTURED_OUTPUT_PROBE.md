# Structured-output contract probe

`npm run probe:structured` is an opt-in executable probe for the roadmap's machine-readable output contract. It does not run as part of CI because the agent CLIs may require authentication or provider quota.

The probe invokes each agent's documented non-interactive structured-output mode with a deterministic marker, then verifies that stdout is syntactically valid for the advertised wire format and that the marker occurs inside parsed structured data.

| Agent | Invocation mode | Expected wire format |
| --- | --- | --- |
| Codex | `codex exec --json` | JSON Lines events |
| Claude Code | `claude -p ... --output-format json` | JSON document |
| Gemini CLI | `gemini -p ... --output-format json` | JSON document |
| OpenCode | `opencode run --format json` | JSON Lines events |

Each run uses a temporary workspace and isolated HOME/XDG directories. Evidence records the agent version, exact redacted command, exit status, redacted/truncated stdout and stderr, expected format, parseability, and whether the deterministic marker was observed. Temporary directories are removed after each agent run.

Verdicts are deliberately conservative:

- `pass`: the process succeeded, all structured output parsed, and the marker was observed in parsed data.
- `fail`: the process exited successfully but stdout violated the documented JSON/JSONL wire format.
- `inconclusive`: the agent could not run successfully, or structured output parsed but the deterministic marker was not observed.
- `unknown`: no documented adapter is encoded.

A probe result is evidence, not an automatic compatibility-matrix update. Do not change `data/matrix.json` from a single local run; record the agent version and reproduce the behavior before changing a support claim.

Write an artifact with:

```sh
npm run probe:structured -- --output=artifacts/structured-output.json
```

Do not commit probe artifacts if their redacted output still contains repository-private information. Review artifacts before sharing them.
