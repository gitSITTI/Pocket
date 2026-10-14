"""Builds a tiny BERT-shaped feature-extraction model for testing the real transformers.js path.

Words in the same concept group get nearly the same vector, so "ship" and "release" land close
together. It has no real language knowledge: it exists to exercise loading, tokenizing, running
ONNX and pooling, with a result that is easy to predict.

The output is committed as tests/fixtures/toy-model. To rebuild it (needs numpy and onnx):

    python3 tests/fixtures/make-toy-model.py tests/fixtures/toy-model
"""
import json, os, shutil, sys
import numpy as np
import onnx
from onnx import helper, TensorProto, numpy_helper

out = sys.argv[1]
GROUPS = {
    "release": "release ship shipping shipped deploy deployment publish launch rollout tag rollback",
    "review": "review reviewer code pull request feedback approve approval comment",
    "failure": "outage incident failure failed broke broken crash downtime",
    "retry": "retry backoff again repeat attempt resilience transient",
    "secret": "secret credential token key leak password",
    "docs": "runbook documentation docs guide procedure checklist",
}
FILLER = "the a of how do we to before after when what is for and in on with your our safely"
specials = ["[PAD]", "[UNK]", "[CLS]", "[SEP]"]
words = list(dict.fromkeys(w for g in GROUPS.values() for w in g.split())) + FILLER.split()
vocab = {tok: i for i, tok in enumerate(specials + words)}
dim = 16
rng = np.random.default_rng(7)
table = (rng.normal(size=(len(vocab), dim)) * 0.05).astype(np.float32)
for gi, g in enumerate(GROUPS.values()):
    for w in g.split():
        table[vocab[w], gi] += 1.0
table[vocab["[PAD]"]] = 0

os.makedirs(os.path.join(out, "onnx"), exist_ok=True)
ids = helper.make_tensor_value_info("input_ids", TensorProto.INT64, ["batch", "seq"])
mask = helper.make_tensor_value_info("attention_mask", TensorProto.INT64, ["batch", "seq"])
types = helper.make_tensor_value_info("token_type_ids", TensorProto.INT64, ["batch", "seq"])
hidden = helper.make_tensor_value_info("last_hidden_state", TensorProto.FLOAT, ["batch", "seq", dim])
node = helper.make_node("Gather", ["embeddings", "input_ids"], ["last_hidden_state"], axis=0)
graph = helper.make_graph([node], "toy", [ids, mask, types], [hidden], [numpy_helper.from_array(table, "embeddings")])
model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
model.ir_version = 9
onnx.checker.check_model(model)
onnx.save(model, os.path.join(out, "onnx", "model.onnx"))
shutil.copy(os.path.join(out, "onnx", "model.onnx"), os.path.join(out, "onnx", "model_quantized.onnx"))

json.dump({
    "model_type": "bert", "architectures": ["BertModel"], "hidden_size": dim, "num_hidden_layers": 1,
    "num_attention_heads": 1, "intermediate_size": 16, "vocab_size": len(vocab), "max_position_embeddings": 64,
    "type_vocab_size": 2, "pad_token_id": 0,
}, open(os.path.join(out, "config.json"), "w"), indent=2)

def special(i, t):
    return {"id": i, "content": t, "single_word": False, "lstrip": False, "rstrip": False, "normalized": False, "special": True}

tok = {
    "version": "1.0", "truncation": None, "padding": None,
    "added_tokens": [special(i, t) for i, t in enumerate(specials)],
    "normalizer": {"type": "BertNormalizer", "clean_text": True, "handle_chinese_chars": True, "strip_accents": None, "lowercase": True},
    "pre_tokenizer": {"type": "BertPreTokenizer"},
    "post_processor": {
        "type": "TemplateProcessing",
        "single": [{"SpecialToken": {"id": "[CLS]", "type_id": 0}}, {"Sequence": {"id": "A", "type_id": 0}}, {"SpecialToken": {"id": "[SEP]", "type_id": 0}}],
        "pair": [{"SpecialToken": {"id": "[CLS]", "type_id": 0}}, {"Sequence": {"id": "A", "type_id": 0}}, {"SpecialToken": {"id": "[SEP]", "type_id": 0}}, {"Sequence": {"id": "B", "type_id": 1}}, {"SpecialToken": {"id": "[SEP]", "type_id": 1}}],
        "special_tokens": {"[CLS]": {"id": "[CLS]", "ids": [vocab["[CLS]"]], "tokens": ["[CLS]"]}, "[SEP]": {"id": "[SEP]", "ids": [vocab["[SEP]"]], "tokens": ["[SEP]"]}},
    },
    "decoder": {"type": "WordPiece", "prefix": "##", "cleanup": True},
    "model": {"type": "WordPiece", "unk_token": "[UNK]", "continuing_subword_prefix": "##", "max_input_chars_per_word": 100, "vocab": vocab},
}
json.dump(tok, open(os.path.join(out, "tokenizer.json"), "w"))
json.dump({"tokenizer_class": "BertTokenizer", "do_lower_case": True, "model_max_length": 64, "unk_token": "[UNK]", "sep_token": "[SEP]", "pad_token": "[PAD]", "cls_token": "[CLS]", "mask_token": "[MASK]"}, open(os.path.join(out, "tokenizer_config.json"), "w"))
json.dump({"unk_token": "[UNK]", "sep_token": "[SEP]", "pad_token": "[PAD]", "cls_token": "[CLS]"}, open(os.path.join(out, "special_tokens_map.json"), "w"))
print("built", out, "vocab", len(vocab), "dim", dim)
