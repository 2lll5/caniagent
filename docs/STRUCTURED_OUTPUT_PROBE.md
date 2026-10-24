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

**Current evidence limitation:** The prompt itself contains the expected marker, and `classifyStructuredOutput()` currently searches for that marker anywhere in the serialized parsed JSON/JSONL. A CLI that includes an input/prompt-echo event can therefore yield a false `pass` even if the model response never contained the marker. A `pass` currently demonstrates parseable captured output with a marker somewhere in it, **not** verified model-response provenance or reliable provider support. Do not promote `data/matrix.json` from this signal alone; corroborate with an independently identified final model-response field/event and retain the agent version. This limitation is tracked in [#101](https://github.com/2lll5/caniagent/issues/101) until a code fix and regression tests are merged.

**Known false-`fail` limitation:** The probe currently redacts and truncates stdout to 12,000 characters **before parsing it**. A complete, valid JSON/JSONL response can be cut mid-record and incorrectly reported as `fail` with `parseable: false`. Until [#103](https://github.com/2lll5/caniagent/issues/103) is fixed and tested, do not interpret `fail` alone as proof that a provider violated its structured-output contract. Investigate locally without publishing unredacted stdout or changing compatibility claims from this result.

A probe result is evidence, not an automatic compatibility-matrix update. Do not change `data/matrix.json` from a single local run; record the agent version and reproduce the behavior before changing a support claim.

Write an artifact with:

```sh
npm run probe:structured -- --output=artifacts/structured-output.json
```

Do not commit probe artifacts if their redacted output still contains repository-private information. Review artifacts before sharing them.
