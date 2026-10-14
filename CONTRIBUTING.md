# Contributing to Pocket

Thanks for helping. Pocket is meant to be a small, clear base that people extend, so the bar for changes to the core is "does everyone benefit?". Things that only some people need usually belong in an extension (see [docs/extending.md](docs/extending.md)).

## Set up

You need Node 22.12 or newer.

```sh
npm ci
sh scripts/setup-hooks.sh   # turns on the gitleaks pre-commit check (install gitleaks first)
                            # an optional private .denylist file adds a check for names you never want published
npm run typecheck
npm test
npm run build
```

## Making a change

1. Open an issue first for anything bigger than a small fix, so we can agree on the approach.
2. Keep the pull request focused on one thing.
3. Add or update tests. `npm test` and `npm run typecheck` must pass.
4. Update the docs if behavior or configuration changed.
5. Fill in the pull request template.

## Guidelines

- **No private material.** Never commit secrets, personal data, or real internal knowledge. Examples must be generic and clearly made up.
- **Keep writes human-approved.** Nothing exposed over MCP may change approved entries directly. See [docs/approval-flow.md](docs/approval-flow.md).
- **Keep it dependency-light.** A new runtime dependency needs a good reason.
- **stdout belongs to the protocol.** The MCP server must only log to stderr.

## License

By contributing, you agree that your contribution is licensed under the Apache License 2.0, as described in section 5 of the license.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).
