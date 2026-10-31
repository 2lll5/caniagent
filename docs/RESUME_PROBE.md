# Resume/session behavior probe

`npm run probe:resume` is an opt-in executable probe for the roadmap's resume/session capability. It does not run as part of CI because agent CLIs may require authentication or provider quota.

For each documented adapter, the probe starts a fresh non-interactive conversation with a deterministic token, then launches a second process using the agent's documented continue/resume-latest mode. The second prompt does not contain the token; a pass therefore requires session context to survive across processes.

| Agent | First turn | Resume turn |
| --- | --- | --- |
| Codex | `codex exec ...` | `codex exec resume --last ...` |
| Claude Code | `claude -p ...` | `claude -p --continue ...` |
| Gemini CLI | `gemini -p ...` | `gemini -r latest ...` |
| OpenCode | `opencode run ...` | `opencode run --continue ...` |

Each agent gets a temporary workspace and home. The probe redirects `HOME`, `USERPROFILE`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, Windows `APPDATA`/`LOCALAPPDATA`, and XDG config/data/state/cache directories into that home; it uses the same temporary environment for both turns. Temporary fixture state is removed after the result is recorded. This reduces accidental reuse of normal agent sessions, but is **not** a filesystem sandbox or a guarantee that an agent cannot access external session/configuration paths.

The probe deliberately removes inherited `NODE_OPTIONS` (including differently cased keys) so Node.js preload hooks cannot alter the observed CLI behavior. Agents that depend on such hooks may not run as they do in the operator's usual environment. Other variables, including authentication, proxy settings, and `NODE_EXTRA_CA_CERTS`, remain inherited; the probe fixture itself does not write credentials. Review artifacts for sensitive data before sharing them.

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
