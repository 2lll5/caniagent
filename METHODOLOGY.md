# Methodology

CanIAgent is an evidence-first compatibility database for coding agents.

## Status meanings

- **yes** — the capability is documented and available in the current product line.
- **partial** — the capability exists but conventions, scope, guarantees, or ergonomics differ.
- **experimental** — the vendor or implementation labels it preview/experimental.
- **unknown** — we have not verified it yet. Unknown is deliberately not treated as "no".
- **no** — an authoritative source explicitly says the capability is unsupported.

## Evidence hierarchy

1. Executable probes against released CLIs.
2. Official vendor documentation.
3. First-party source code.
4. Release notes.
5. Maintainer-confirmed issue/discussion.

Blog posts and social media can help discover a change, but should not be the sole evidence for a `yes` or `no` cell.

## Freshness

Every evidence item has a `checked` date. A scheduled maintenance workflow should periodically re-check high-churn rows. Changes should update both `data/matrix.json` and `docs/matrix.json`.

## What a probe should prove

A useful probe is behavior-based. It should create the smallest fixture that distinguishes support from non-support, invoke a released CLI, and save:

- agent version
- platform
- exact command
- exit code
- machine-readable output when available
- fixture hash
- redacted log

`npm run probe` currently provides environment/version discovery. Behavior probes are tracked in the roadmap and issues.

## Corrections

If a cell is wrong, open an issue with the agent version, platform, expected behavior, actual behavior, and an authoritative link or a minimal reproduction.
