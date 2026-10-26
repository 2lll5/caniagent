# Structured-output contract probe

`npm run probe:structured` is an opt-in executable probe for the roadmap's machine-readable output contract. It does not run as part of CI because the agent CLIs may require authentication or provider quota.

The probe invokes each agent's documented non-interactive structured-output mode with a deterministic marker, then verifies that stdout is syntactically valid for the advertised wire format and that the **final recognized model-response text** exactly matches the marker. Input echoes, arbitrary metadata, and earlier responses are not positive evidence; explicit failure events invalidate an otherwise matching response.

| Agent | Invocation mode | Expected wire format |
| --- | --- | --- |
| Codex | `codex exec --json` | JSON Lines events |
| Claude Code | `claude -p ... --output-format json` | JSON document |
| Gemini CLI | `gemini -p ... --output-format json` | JSON document |
| OpenCode | `opencode run --format json` | JSON Lines events |

Each run uses a temporary workspace and redirects `HOME`, `USERPROFILE`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, Windows AppData, and XDG config/data/state/cache paths into its temporary home. Inherited `NODE_OPTIONS` is removed, but authentication, proxy, and other environment variables may remain. This is **not a filesystem or process sandbox**. Temporary fixtures are removed after each agent run.

Classification uses the captured stdout **before** redaction and evidence truncation, with an 8 MiB child-process buffer limit. The result artifact contains only redacted stdout/stderr (each truncated to 12,000 characters), not raw stdout. An output-buffer overflow or other subprocess error is inconclusive even if a partial capture contains the marker. Evidence also records the agent version, redacted command, exit status, expected format, parseability, and marker verdict.

For Gemini CLI JSON output, a non-null `error` envelope vetoes a matching `response` marker, even if the subprocess exits with status zero. A null or absent `error` field does not invalidate a legitimate response.

OpenCode `--format json` may omit the final `step_finish` event in v2 (see [upstream issue #53207](https://github.com/anomalyco/opencode/issues/53207), checked 2026-10-26). The absence of that event alone does not reject a matching final model response. If a `step_finish` is observed **after** the last model response, its reason must be `stop`; `tool-calls`, `length`, or an unrecognized reason leaves the verdict `inconclusive`. This avoids treating an explicitly unfinished step as a completed response while tolerating the upstream event-loss behavior.

Verdicts are deliberately conservative:

- `pass`: the process succeeded, all structured output parsed, no explicit failure event was present, and the **last recognized model response** exactly matched the marker. For Codex JSONL, a `turn.completed` event must also follow the final model reply, and a later turn cannot reuse an earlier turn's marker if it completes without its own model reply.
- `fail`: the process exited successfully but stdout violated the documented JSON/JSONL wire format.
- `inconclusive`: the agent could not run successfully (including output-buffer overflow), an explicit failure event was present, or parsed output lacked a final model response exactly matching the marker.
- `unknown`: no documented adapter is encoded.

A probe result is evidence, not an automatic compatibility-matrix update. Do not change `data/matrix.json` from a single local run; record the agent version and reproduce the behavior before changing a support claim.

Write an artifact with:

```sh
npm run probe:structured -- --output=artifacts/structured-output.json
```

Do not commit probe artifacts if their redacted output still contains repository-private information. Review artifacts before sharing them.
