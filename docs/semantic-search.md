# Search by meaning

Pocket's normal search matches words. Ask for "deploy" and it will not find an entry that only says "ship" and "release". Search by meaning fixes that: it also compares what a question and an entry are about, using a small language model that runs on your own machine.

It is **off by default** and optional. Without it, Pocket has no extra dependencies and nothing in this page applies.

## Turn it on

1. Install the optional package in the folder that holds `pocket.config.json`:

   ```sh
   cd path/to/your-knowledge-base
   npm install @huggingface/transformers
   ```

   This is the only extra install. Pocket finds it there however you run Pocket (`npx pocket-bok`, a global install, or a clone).

2. Add one line to the config file:

   ```json
   { "semanticSearch": true }
   ```

3. Optional: prepare it now instead of on the first search.

   ```sh
   pocket index
   ```

   The first run downloads the default model, about 23 MB, into `.pocket/embeddings/models`, then makes a vector for every entry. After that, only new or changed entries are processed.

Search by meaning needs a config file. If you run Pocket with only `POCKET_CONTENT_DIR`, create a `pocket.config.json` next to your content.

### What the install costs

- `@huggingface/transformers` pulls in onnxruntime, which does the work. On Linux x64 the install measured about 480 MB in `node_modules`.
- On Linux x64, onnxruntime's install step also tries to download GPU libraries. If you only need the CPU, which is plenty for this, set `ONNXRUNTIME_NODE_INSTALL=skip` when you install: `ONNXRUNTIME_NODE_INSTALL=skip npm install @huggingface/transformers`. CI does this.
- Add `node_modules/` to the knowledge base's `.gitignore`. The template already does.

The package and the model are loaded the first time they are needed, so a server that never searches pays nothing.

## What you get

The `search` tool and `pocket search` return one list that merges two rankings: the word search Pocket always had, and a ranking by meaning. They are merged by position, not by score, because the two kinds of score are not on the same scale. An entry near the top of both lists comes first.

Each result says how it was found:

| Field | Meaning |
| --- | --- |
| `matched` | `keyword`, `meaning` or `both`. |
| `similarity` | How close the entry is to the question in meaning, from -1 to 1. Present when the meaning ranking contributed. Only compare values within one result list. |
| `score` | Relative rank after merging. 1 means first in both lists. |

When the answer is keyword-only or incomplete, the response has a `note` saying why, so an agent can tell its user. Examples: the vectors are still being made after a start, or the model could not run.

## Configuration

`semanticSearch` is `true`, `false`, or an object:

```json
{
  "semanticSearch": {
    "model": "Xenova/all-MiniLM-L6-v2",
    "dtype": "q8",
    "cacheDir": ".pocket/embeddings",
    "minSimilarity": 0
  }
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `model` | `Xenova/all-MiniLM-L6-v2` | A Hugging Face model id, or a path to a model folder (see below). |
| `dtype` | `q8` | Weight precision: `fp32`, `fp16`, `q8`, `int8`, `uint8`, `q4`, `bnb4` or `q4f16`. The model must publish that file. `q8` is the small 8-bit build. |
| `cacheDir` | `.pocket/embeddings` | Where vectors and downloaded models are kept. Relative to the config file. |
| `minSimilarity` | `0` | Entries that match only by meaning and score below this are dropped. See below. |

The default model, [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2), is Apache-2.0 and produces 384 numbers per entry. Any other model that transformers.js can run as a plain `feature-extraction` model with mean pooling should work; changing `model` or `dtype` makes Pocket start over with new vectors.

Models that need a different calling convention are not supported yet. That includes IBM's granite-embedding (it returns a ready-made sentence vector) and the Jina v2 models (they need custom code).

### `minSimilarity`

Similarity values from different models are not comparable, and Pocket has not calibrated any of them, so the default keeps everything and relies on the merge to put weak matches low. If a model returns noise for questions your knowledge base cannot answer, raise it a little and look at the `similarity` values you actually get. Entries that match by words are never dropped by this.

### Offline use

Put a model's files in a folder (`config.json`, `tokenizer.json`, and the weights as `onnx/model_quantized.onnx` for `q8`), then point `model` at it:

```json
{ "semanticSearch": { "model": "./models/all-MiniLM-L6-v2" } }
```

A folder next to the config file wins over a Hugging Face id of the same shape. Pocket never touches the network for a folder.

## What is embedded

For each entry: the title, summary and tags, then the start of the body, up to 1,500 characters in all. The model also reads only a limited length. A long entry is therefore matched by meaning on its opening, while the word search still covers all of it. Keep the summary honest and specific: it is the most useful sentence for both searches.

Entry text never leaves your machine. The only network use is the one-time model download from Hugging Face.

## How it stays up to date

- When the server starts, it makes vectors in the background. Searches work from the first second: until the vectors are ready they return keyword results and say so.
- When entries change on disk, the next search starts a refresh for the changed entries only.
- Vectors are cached in `<cacheDir>/vectors.json`, one file per knowledge base, with a checksum per entry. It is private to the user (mode 0600), written atomically, and safe to delete. It should not be committed: the template's `.gitignore` excludes `.pocket/`.
- A cache made by a different model or settings is ignored. A damaged cache is ignored with a warning.
- If the model cannot run (package missing, no network for the first download, out of memory), searches keep returning keyword results with a note, and Pocket tries again after a minute.

## What is not done

- **A reranker.** The roadmap listed one as optional. This version does not include it.
- **Other model families** (see above).
- **A measured quality bar.** The tests run the real package and runtime on a toy model whose vectors are easy to predict, so they prove that loading, tokenizing, pooling, caching and merging work. They do not say how good the default model's rankings are on your content. Retrieval evals are the next roadmap item; until then, try your own questions with `pocket search`.
- **Large knowledge bases.** Vectors are compared one by one in memory, which is fine for thousands of entries. Beyond that, plug in a real vector index (below).

## Use your own embedder

When Pocket is a library, anything with this shape works, for example a call to a hosted service. Remember that doing so sends entry text to that service.

```ts
import { KnowledgeBase, SemanticSearch, createServer, loadConfig, ProposalStore, type Embedder } from "pocket-bok";

const embedder: Embedder = {
  id: "my-service:v1", // change it whenever the model changes: old vectors are then discarded
  async embed(texts) {
    return texts.map((text) => myVectorFor(text)); // one Float32Array per text, all the same length
  },
};

const config = loadConfig();
const kb = new KnowledgeBase(config);
const semantic = new SemanticSearch(kb, embedder, { cacheFile: ".pocket/vectors.json" });
const server = createServer(kb, new ProposalStore(config.proposalsDir), semantic);
void semantic.sync(); // make vectors in the background
```

## Troubleshooting

| What you see | What to do |
| --- | --- |
| `needs the optional package @huggingface/transformers` | Run `npm install @huggingface/transformers` in the folder it names. |
| `Search by meaning is still getting ready` | Normal for the first moments after a start. Run `pocket index` once to do it ahead of time. |
| A download error on the first run | The model comes from huggingface.co. Check the network or proxy, or use a model folder. |
| `does not look like a model folder` | The `model` path has no `config.json`. |
| Results look wrong | Delete `.pocket/embeddings/vectors.json` and run `pocket index`. If that does not help, try another model and compare with `pocket search`. |
