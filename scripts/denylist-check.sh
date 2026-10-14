#!/bin/sh
# Fails when a term from a private denylist appears in a public repo.
#
# The term list is deliberately NOT stored in the repo: that would publish the very
# names you want hidden. Locally it is an untracked file named .denylist. In CI it
# comes from a secret. One term per line; blank lines and lines starting with # are
# ignored. Matching is case-insensitive and literal (no regular expressions).
#
# Usage:
#   sh scripts/denylist-check.sh staged           staged files and their names (pre-commit)
#   sh scripts/denylist-check.sh message <file>   a commit message file (commit-msg)
#   sh scripts/denylist-check.sh tree             every tracked file and file name
#   sh scripts/denylist-check.sh history [range]  author, committer and message of each commit
#
# Set DENYLIST_FILE to read the terms from somewhere other than ./.denylist.
#
# In GitHub Actions the log is public, so the script prints only a count there.
# Locally it prints file:line locations. It never prints a term or the text around it.

set -eu

mode=${1:-}
source_file=${DENYLIST_FILE:-.denylist}

if [ ! -f "$source_file" ]; then
  echo "denylist: no term list at $source_file, so this check did not run." >&2
  exit 0
fi

terms=$(mktemp)
out=$(mktemp)
trap 'rm -f "$terms" "$out"' EXIT INT TERM

# Drop Windows line endings, comments and blank lines. A blank pattern would match everything.
tr -d '\r' < "$source_file" | grep -v -e '^[[:space:]]*#' -e '^[[:space:]]*$' > "$terms" || true

if [ ! -s "$terms" ]; then
  echo "denylist: $source_file has no terms, so this check did not run." >&2
  exit 0
fi

note() { echo "$1" >> "$out"; }

# Read text on stdin and note a location for each line holding a term. $1 labels the source.
scan_stdin() {
  grep -I -n -i -F -f "$terms" | cut -d: -f1 | while IFS= read -r line; do
    note "$1:$line"
  done
}

check_name() {
  if printf '%s\n' "$1" | grep -q -i -F -f "$terms"; then
    note "$1 (file name)"
  fi
}

case "$mode" in
  staged)
    git diff --cached --name-only --diff-filter=ACMR | while IFS= read -r f; do
      check_name "$f"
      git show ":$f" | scan_stdin "$f"
    done
    ;;

  message)
    file=${2:?usage: denylist-check.sh message <file>}
    if grep -q -i -F -f "$terms" "$file"; then
      note "commit message"
    fi
    ;;

  tree)
    git ls-files | while IFS= read -r f; do
      check_name "$f"
    done
    git grep -I -n -i -F -f "$terms" -- . | cut -d: -f1,2 | while IFS= read -r hit; do
      note "$hit"
    done
    ;;

  history)
    range=${2:-}
    git log --format=%H ${range:+"$range"} 2>/dev/null | while IFS= read -r sha; do
      if git log -1 --format='%an %ae %cn %ce%n%B' "$sha" | grep -q -i -F -f "$terms"; then
        note "commit $(printf '%s' "$sha" | cut -c1-8) (author, committer or message)"
      fi
    done
    ;;

  *)
    echo "usage: sh scripts/denylist-check.sh staged | message <file> | tree | history [range]" >&2
    exit 2
    ;;
esac

count=$(wc -l < "$out" | tr -d ' ')
if [ "$count" -gt 0 ]; then
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "denylist: found $count place(s) containing a term from the private list." >&2
    echo "denylist: locations are hidden because this log is public." >&2
    echo "denylist: run 'sh scripts/denylist-check.sh tree' and '... history' locally to see where." >&2
  else
    echo "denylist: found $count place(s) containing a term from your private list:" >&2
    sort -u "$out" | sed 's/^/  /' >&2
    echo "denylist: the matched text is not shown on purpose. Open each location and remove it." >&2
  fi
  exit 1
fi
exit 0
