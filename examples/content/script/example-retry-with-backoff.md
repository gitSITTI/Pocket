---
id: example-retry-with-backoff
type: script
title: "Example: Retry a command with exponential backoff"
summary: A sample script entry with a small shell function that retries a flaky command.
tags:
  - example
  - shell
  - reliability
status: active
version: 1
created: 2026-10-14
updated: 2026-10-14
links: []
---

This is a made-up entry. It shows the shape of a `script` entry, not real guidance.

## Purpose

Retry a command that sometimes fails for temporary reasons, waiting longer after each failure.

## Script

```sh
retry() {
  attempts=$1; shift
  delay=1
  n=1
  until "$@"; do
    if [ "$n" -ge "$attempts" ]; then
      echo "giving up after $n attempts" >&2
      return 1
    fi
    echo "attempt $n failed, retrying in ${delay}s" >&2
    sleep "$delay"
    delay=$((delay * 2))
    n=$((n + 1))
  done
}
```

## Usage

```sh
retry 5 curl --fail --max-time 10 https://example.com/health
```

## Caveats

- Only retry operations that are safe to repeat.
- Add random jitter when many callers might retry at the same moment.
- Cap the delay so a long outage does not cause very long sleeps.
