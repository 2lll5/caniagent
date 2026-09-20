# MCP stdio behavior probe

`npm run probe:mcp -- --output=artifacts/mcp-probe.json` runs an opt-in behavior probe for the MCP client row in the compatibility matrix.

The probe creates a temporary workspace and home for each supported agent, configures a dependency-free local stdio MCP server named `caniagent_echo`, records the installed agent version, and asks the agent to call the echo tool with a deterministic marker. Temporary files are removed after each run. It does not modify the developer's normal agent configuration.

## Verdicts

- `pass`: the agent command succeeded and the deterministic tool result was observed.
- `fail`: the agent command succeeded but the expected tool result was absent.
- `skip`: the agent executable was not installed.
- `inconclusive`: execution failed, timed out, was interrupted, or could not otherwise produce trustworthy behavior evidence. Authentication-dependent failures therefore do not become negative compatibility claims.

The JSON evidence records platform, Node version, agent version command, exact redacted execution command, exit status, and redacted/truncated stdout and stderr. Do not promote `data/matrix.json` claims from a single inconclusive run; retain reproducible probe artifacts and the tested agent version.

## Isolation and credentials

The MCP server itself requires no network access, API key, package install, or external service. Agent execution may still require the provider's normal authentication and may consume provider quota. The probe redirects `HOME`, `USERPROFILE`, and XDG config/data/state paths to temporary directories. Output passes through the shared probe redactor before it is persisted.

The generated configurations use the documented project/user configuration surfaces for Codex, Claude Code, Gemini CLI, and OpenCode. Because those CLIs evolve independently, a configuration parse failure should remain `inconclusive` until the adapter is updated and re-tested.
