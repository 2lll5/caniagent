# Resume/session behavior probe

`npm run probe:resume` is an opt-in executable probe for the roadmap's resume/session capability. It does not run as part of CI because agent CLIs may require authentication or provider quota.

For each documented adapter, the probe starts a fresh non-interactive conversation with a deterministic token, then launches a second process using the agent's documented continue/resume-latest mode. The second prompt does not contain the token; a pass therefore requires session context to survive across processes.

| Agent | First turn | Resume turn |
| --- | --- | --- |
| Codex | `codex exec ...` | `codex exec resume --last ...` |
| Claude Code | `claude -p ...` | `claude -p --continue ...` |
| Gemini CLI | `gemini -p ...` | `gemini -r latest ...` |
| OpenCode | `opencode run ...` | `opencode run --continue ...` |

Each agent gets its own temporary workspace and isolated HOME/XDG directories, so the probe cannot resume or modify the user's existing sessions. Temporary state is removed after the result is recorded. The environment is otherwise inherited so an operator may intentionally provide authentication through environment variables; no credentials are written by the probe.

Evidence records agent version, redacted commands, exit status, redacted/truncated stdout and stderr, and whether the resumed turn recalled the deterministic marker.

Verdicts are conservative:

- `pass`: both turns succeeded and the resumed turn emitted the first-turn marker.
- `fail`: both turns succeeded, but the resumed turn did not contain the marker.
- `inconclusive`: either process could not run successfully, including missing CLI, authentication, provider, or timeout failures.
- `unknown`: no documented adapter is encoded.

A probe result is evidence, not an automatic compatibility-matrix update. Reproduce behavior with the recorded agent version before changing support claims.

Write an artifact with:

```sh
npm run probe:resume -- --output=artifacts/resume-session.json
```

Review artifacts before sharing or committing them; redaction is defense in depth and cannot guarantee removal of arbitrary repository-private text emitted by an agent.
