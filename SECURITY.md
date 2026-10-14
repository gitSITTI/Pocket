# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue.

Use GitHub's private reporting: open this repository's **Security** tab and choose **Report a vulnerability**.
Include what you found, how to reproduce it, and the impact you think it has. You will get a reply as soon as a maintainer can look.

## Supported versions

Only the latest release receives security fixes while the project is on 0.x.

## What is in scope

- Writing outside the configured content or proposals directories (path traversal).
- Any way for an MCP client to change approved knowledge without a human running `pocket proposals approve`.
- Reading files outside the configured content directories.
- Vulnerabilities in the server or CLI code and its dependencies.

Out of scope: the contents of your own knowledge repositories, and the safety of an MCP client or agent you connect.

## How the approval model protects you

- The MCP server has no tool that changes an entry. `add_entry` and `update_entry` only write a proposal file.
- Approval is a CLI command (`pocket proposals approve`) that is not exposed over MCP.
- For a hard guarantee, mount your content directory read-only for the server process and give it a separate writable directory for proposals. `compose.yaml` shows how. Then the server cannot change approved knowledge even if it is compromised.
- Do not give an agent a shell on the same machine and account that you use for approvals. A shell could run `pocket proposals approve --yes` itself. Keep approval in a place the agent cannot reach, and review changes in git before merging.

## Keeping secrets out of the repository

This repository is scanned with [gitleaks](https://github.com/gitleaks/gitleaks) before commits (`.githooks/pre-commit`) and in CI.
Run `sh scripts/setup-hooks.sh` once per clone to turn on the commit hook.
Never put credentials, personal data or confidential material in entries or examples.
