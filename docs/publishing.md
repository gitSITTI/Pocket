# Publishing Pocket

Pocket is published in two places, in this order:

1. **npm**, as `pocket-bok`. This is what MCP clients download and run (`npx pocket-bok`).
2. **The [MCP Registry](https://modelcontextprotocol.io/registry/quickstart)**, under the name `io.github.gitSITTI/pocket`. The registry stores only metadata and points at the npm package, which is why npm comes first. The registry is in preview, so details can change.

A pushed version tag does both through `.github/workflows/publish.yml`. This page is for whoever owns the project.

## The files involved

| File | What it does |
| --- | --- |
| `package.json` | `mcpName` is the registry name. The registry checks it against `server.json`, which proves the npm package belongs to this server. The `pocket-bok` bin lets `npx pocket-bok` start the server. |
| `server.json` | Registry metadata: name, description, the npm package, and the environment variables a client can set. |
| `scripts/registry-metadata.mjs` | Checks that the two files agree (names, versions, repository owner, description length) and that the release tag matches the version. It runs in the tests and in the publish workflow. |
| `.github/workflows/publish.yml` | Build, check, publish to npm, publish to the registry. |

## One-time setup

1. **An npm account** that will own `pocket-bok`. The name was free when checked on 2026-10-14.
2. **An npm token.** Create an automation token on npmjs.com and save it as the repository secret `NPM_TOKEN`. After the first release you can switch to npm's trusted publishing, which needs no stored token; see npm's documentation.
3. **A `release` environment** (Settings, Environments) with yourself as a required reviewer. The npm step then waits for you to click approve, which fits how Pocket treats every other write. Without reviewers it runs straight away.

No secret is needed for the registry: it uses GitHub's identity for the repository.

## Making a release

```sh
npm version 0.2.0        # bumps package.json and package-lock.json, syncs server.json, commits and tags
git push origin main --follow-tags
```

`npm version` runs `scripts/registry-metadata.mjs sync`, so `server.json` gets the same version. Merge to `main` first: the workflow refuses a tag that is not on `main`.

The workflow then runs the tests, builds, checks the metadata and the package contents, waits for your approval, publishes to npm with provenance, waits for the package to appear, and publishes to the registry. Check the result:

```sh
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.gitSITTI/pocket"
```

To check the metadata yourself at any time: `npm run registry:check`.

## If something fails

| Message | What to do |
| --- | --- |
| `You do not have permission to publish this server` | The registry matched your GitHub account to a different name. The name must start with `io.github.` and your GitHub account or organization name. The workflow uses the capitalization in `server.json`; if the registry rejects it, change `mcpName` in `package.json` and `name` in `server.json` to the lowercase form and release again. |
| `Registry validation failed for package` | The npm package is missing or its `mcpName` does not match `server.json`. |
| `Authentication failed` | The registry job needs `id-token: write`, which the workflow sets. Check that Actions has not been restricted in the repository settings. |
| The npm step fails with a 403 | The token is wrong or the package name is taken. |
| `registry-metadata` complains about the tag | Tag `v` plus the version in `package.json`, for example `v0.2.0` for version `0.2.0`. |

A version cannot be published to npm twice. If the registry step fails after npm succeeded, fix the problem and run the registry steps again by hand (`mcp-publisher validate`, `login github`, `publish`) rather than re-releasing.

## Not done yet

- **A `.mcpb` bundle.** The registry also accepts a prebuilt bundle attached to a GitHub release. Pocket's dependencies would have to be packed into it. npm covers the same clients for now.
- **The mcp-publisher checksum** in the workflow was copied from the release page on GitHub. If it is wrong the workflow stops at the checksum step and publishes nothing; fix it from the `registry_<version>_checksums.txt` file in that release.
