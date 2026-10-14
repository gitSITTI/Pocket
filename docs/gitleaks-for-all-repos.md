# Secret scanning and private-name checks for all your repos

Every public repository should block secrets before they are committed and again in CI. Pocket ships a setup you can copy into any repo: gitleaks for credentials, and a denylist check for names you never want published (see [Keeping private names out](#keeping-private-names-out-denylist)).

## The four files for secret scanning

Copy these from this repository into the root of the other repo, keeping the same paths:

| File | Purpose |
| --- | --- |
| `.gitleaks.toml` | Scanning rules (extends gitleaks' defaults) |
| `.githooks/pre-commit` | Blocks a commit that stages a secret |
| `scripts/setup-hooks.sh` | Turns the hook on for a clone |
| `.github/workflows/gitleaks.yml` | Scans every push and pull request in GitHub Actions |

Take the workflow from `template/.github/workflows/gitleaks.yml` in this repository. It is the same scan job that runs in `.github/workflows/ci.yml`, on its own.

Then, in each clone, install [gitleaks](https://github.com/gitleaks/gitleaks#installing) and run:

```sh
sh scripts/setup-hooks.sh
```

If you prefer the pre-commit framework, `.pre-commit-config.yaml` does the same job.

## How the CI scan works

The workflow downloads a pinned gitleaks release, checks its SHA-256 against the value in the workflow, and scans the full git history. It does not use the gitleaks GitHub Action, so it works the same for personal and organization accounts and needs no license key or secrets.

To upgrade gitleaks, change `GITLEAKS_VERSION` and `GITLEAKS_SHA256` at the top of the job. Get the new hash from the `*_checksums.txt` file attached to the release (use the `linux_x64.tar.gz` line).

## Keeping private names out (denylist)

Gitleaks finds credentials. It does not know that a project name, a family name, an employer or a hostname should never appear in a public repo. The denylist check covers that.

You keep a list of terms that must never be published. The check fails a commit or a CI run if any of them shows up in a file, a file name, a commit message, or a commit's author or committer.

**The list is never stored in the repo**, because that would publish the very names you want hidden:

- Locally it is an untracked file named `.denylist` (already in `.gitignore`).
- In CI it is a repository secret named `PUBLIC_DENYLIST`.

Format: one term per line. Blank lines and lines starting with `#` are ignored. Matching is case-insensitive and literal, so a very short term will also match inside longer words.

```text
# .denylist: never commit this file
my-private-project
some-internal-hostname
```

Good things to put on the list: the names of private projects, agents, servers and hosts; your employer and its programs; family and trust names; anything else you would not want a stranger to connect to you.

Set it up:

1. Create `.denylist` in each public repo's clone with your terms. Keep a master copy somewhere private, since the file is not in git.
2. Add the same text as a repository secret: Settings, Secrets and variables, Actions, New repository secret, name `PUBLIC_DENYLIST`. With the GitHub CLI: `gh secret set PUBLIC_DENYLIST < .denylist`.
3. Copy these files into the repo, keeping the same paths: `scripts/denylist-check.sh`, `.githooks/commit-msg`, `.github/workflows/denylist.yml`. The `.githooks/pre-commit` from this repo already calls the script.
4. Run `sh scripts/setup-hooks.sh` in each clone.

What it prints: locally, the file and line of each hit (`notes.md:12`), never the matched text. In GitHub Actions only a count, because the log of a public repo is public. Run `sh scripts/denylist-check.sh tree` and `sh scripts/denylist-check.sh history` locally to find the locations.

Limits to know about:

- It catches the terms you listed, not things you did not think of. It is a safety net, not a substitute for judgment.
- It reads text. Images, PDFs and other binary files are skipped.
- On a fork there is no secret, so the CI job shows a warning and skips. The local hook still protects you.
- If a term already reached a public repo, treat it as exposed. Removing it from the latest commit does not remove it from history.

## Check what is already there

The hook only looks at new commits. To scan a repo's full history once:

```sh
gitleaks git --redact --verbose --config .gitleaks.toml
```

## If a secret is found

1. **Revoke or rotate it first.** Treat it as exposed, because git history is permanent and public repos are scraped.
2. Remove it from the code and load it from an environment variable or secret store.
3. Only then consider rewriting history, and know that it does not un-expose the secret.

## False positives

Add a narrow allowlist entry in `.gitleaks.toml` (a specific path or a specific regex), not a broad one. The lockfile entry in this repo's config is an example.
