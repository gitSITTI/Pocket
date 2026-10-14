#!/bin/sh
# Point git at the hooks in .githooks/ for this clone.
set -e
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit
echo "Git hooks enabled. Commits will now be scanned for secrets with gitleaks."
