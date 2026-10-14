# Secret scanning for all your repos

Every public repository should block secrets before they are committed and again in CI. Pocket ships a setup you can copy into any repo.

## The four files

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
