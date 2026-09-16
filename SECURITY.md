# Security policy

CanIAgent scans file names and invokes installed agent binaries only when you explicitly run the probe script.

## Reporting

Please report vulnerabilities privately through GitHub's security advisory flow when available. Do not include API keys, access tokens, private repository contents, or credentials in issues.

## Probe safety

`npm run probe` currently executes only `--version` and `--help` for known agent commands. Future behavior probes must default to isolated fixtures and must not enable destructive or permission-bypassing flags.
