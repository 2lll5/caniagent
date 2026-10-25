# MCP stdio behavior probe

`npm run probe:mcp -- --output=artifacts/mcp-probe.json` runs an opt-in behavior probe for the MCP client row in the compatibility matrix.

The probe creates a temporary workspace and home for each supported agent, configures a dependency-free local stdio MCP server named `caniagent_echo`, records the installed agent version, and asks the agent to call the echo tool with a deterministic marker. Temporary files are removed after each run. The fixture writes to temporary paths, but the invoked agent CLI may still consult configuration paths inherited from the caller (see the isolation limitation below).

## Verdicts

- `pass`: the agent command succeeded and its captured stdout/stderr contained the expected fixed marker. This is an **output-only signal**, not proof that an MCP tool was invoked.
- `fail`: the agent command succeeded but the expected marker was absent from captured output. This does not by itself prove the agent lacks MCP support.
- `skip`: the agent executable was not installed.
- `inconclusive`: execution failed, timed out, was interrupted, or could not otherwise produce trustworthy behavior evidence. Authentication-dependent failures therefore do not become negative compatibility claims.

## Evidence limitation (current implementation)

The probe prompt itself contains `CANIAGENT_MCP_ECHO_OK`, and `classifyMcpResult()` currently checks for that string in captured stdout/stderr. An agent that merely echoes or quotes its prompt can therefore yield a **false `pass` without calling `caniagent_echo`**. Conversely, output truncation or redaction can hide a real tool result and yield `fail`. Treat both verdicts as diagnostic observations, not provider-backed proof of tool invocation or non-support. Do **not** promote compatibility-matrix statuses based on this marker alone; corroborate with an independently observed MCP `tools/call` trace or a verified server-side invocation record, and preserve the tested agent version. This limitation remains until a code fix and its regression tests are merged.

The JSON evidence records platform, Node version, agent version command, exact redacted execution command, exit status, and redacted/truncated stdout and stderr. Do not promote `data/matrix.json` claims from a single inconclusive run; retain reproducible probe artifacts and the tested agent version.

## Isolation and credentials

The MCP server itself requires no network access, API key, package install, or external service. Agent execution may still require the provider's normal authentication and may consume provider quota. The probe redirects `HOME`, `USERPROFILE`, and XDG config/data/state paths to temporary directories. Output passes through the shared probe redactor before it is persisted.

**Isolation limitation (current implementation):** The probe copies the caller's environment and redirects `HOME`, `USERPROFILE`, and XDG config/data/state directories, but does not yet override `CODEX_HOME` or `CLAUDE_CONFIG_DIR`. If either variable points outside the temporary home, the corresponding CLI may read existing user configuration, so the run is **not guaranteed to be configuration-isolated**. Use a controlled environment and do not treat such results as clean-room compatibility evidence. The MCP-specific fix is tracked in [#99](https://github.com/2lll5/caniagent/issues/99); related non-MCP probes are tracked in [#100](https://github.com/2lll5/caniagent/issues/100).

The generated configurations use the documented project/user configuration surfaces for Codex, Claude Code, Gemini CLI, and OpenCode. Because those CLIs evolve independently, a configuration parse failure should remain `inconclusive` until the adapter is updated and re-tested.
