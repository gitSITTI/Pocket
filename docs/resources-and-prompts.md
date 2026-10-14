# Resources and prompts

Besides tools, Pocket offers entries to MCP clients in two other ways that the [MCP specification](https://modelcontextprotocol.io/specification/2025-06-18/server) defines. Which one a client uses is up to the client. Most clients show resources in an attachment picker and prompts as slash commands, and some show neither.

Both are read-only. Neither one lets anything be written, and both are offered even when the server runs with `readOnly`.

## Resources: pick an entry to attach

Every entry is a resource at `pocket://entry/<id>`, for example `pocket://entry/release-checklist`.

- **Listing** (`resources/list`) returns every entry, whatever its status. The description of a draft or deprecated entry starts with its status, such as `(draft) Not ready yet.`
- **Reading** (`resources/read`) returns the entry as Markdown with its frontmatter, served as `text/markdown`. The frontmatter is rewritten in Pocket's standard order, so it can differ in layout from the file on disk.
- **Completion** works for the `id` part of the address, so a client can offer matches as the person types.
- **Annotations** say how much each entry matters. `audience` is `["user", "assistant"]`. `lastModified` is the entry's `updated` date. `priority` follows the status:

| Status | Priority |
| --- | --- |
| `active` | 0.8 |
| `draft` | 0.3 |
| `deprecated` | 0.1 |

An id that does not match `[a-z0-9][a-z0-9-]*` is refused with an invalid-params error before anything is looked up, so an address such as `pocket://entry/..%2F..%2Fsecret` cannot reach a file. An id that is valid but not in the knowledge base returns the MCP "resource not found" error (`-32002`).

When two layers define the same id, the resource is the entry that wins, the same as everywhere else in Pocket.

## Prompts: run a playbook

Active entries of the types listed in `promptTypes` are offered as prompts, named after the entry id. The default is `["process"]`, so each active process entry becomes a command such as `/release-checklist`.

A prompt takes one optional argument, `context`, for what the person is applying it to. `prompts/get` returns a single user message:

```
Follow "Release checklist" from the knowledge base (pocket://entry/release-checklist, version 3).

<the entry body>

Apply it to this:
<context, if given>
```

Draft and deprecated entries are not offered, and asking for one by name is refused. A prompt puts an entry's text in front of the model as if the person had typed it, so only entries that have been approved and marked `active` get that treatment.

To offer other types, set `promptTypes` in the config file:

```json
{
  "promptTypes": ["process", "lesson-learned"]
}
```

Type names use lowercase letters, digits and hyphens. A name that matches no entries simply offers nothing.

## Staying current

The lists follow the files. Editing an entry, or approving a proposal from the CLI in another terminal, changes what the next `resources/list` and `prompts/list` return, with no restart.

The server also tells connected clients. It checks the content folders every five seconds and, when something changed, sends `notifications/resources/list_changed` and `notifications/prompts/list_changed`. Set `POCKET_WATCH_INTERVAL_MS` to change the interval, or to `0` to turn the checks off. The check reads file modification times only, so it is cheap on a small knowledge base.

The notifications say that the lists changed, not what changed. Clients fetch the lists again.

## Using it as a library

`createServer(kb, store)` registers resources and prompts along with the tools. `watchForChanges(kb, server, intervalMs)` starts the periodic check and returns a function that stops it. `createChangeNotifier(kb, server)` returns a function you can call yourself, for example from a file watcher; it returns `true` when it sent notifications.
