import { hasHiddenCharacters, makeVisible } from "./sanitize.js";
import type { EntryMeta } from "./types.js";

export interface LintFinding {
  /** Which part of the entry the finding is about. */
  field: "title" | "summary" | "tags" | "body";
  message: string;
}

/**
 * Phrases that are addressed to an agent rather than describing the entry.
 * Titles, summaries and tags are what search and agents see first, so text there
 * can steer which entry gets found and trusted. These patterns are deliberately
 * narrow: they are a prompt to look closer, not a verdict.
 */
const INSTRUCTION_PATTERNS: { pattern: RegExp; why: string }[] = [
  {
    pattern:
      /\b(?:ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|other|all|any|your)\b[^.\n]{0,30}\b(?:instructions?|prompts?|rules?|guidelines?|polic(?:y|ies))\b/i,
    why: "tries to override other instructions",
  },
  { pattern: /\b(?:system prompt|developer message|hidden instructions?)\b/i, why: "mentions the system prompt" },
  {
    pattern: /\b(?:do not|don't|never)\s+(?:tell|inform|mention|reveal|show|notify)\b[^.\n]{0,30}\b(?:user|human|operator|reviewer)\b/i,
    why: "asks to hide something from the user",
  },
  {
    pattern: /\b(?:always|must|only)\s+(?:use|call|select|choose|prefer|pick|load|run|invoke|trust)\s+(?:this|these|me|it)\b/i,
    why: "tells an agent to always pick this entry",
  },
  {
    pattern: /\bbefore\s+(?:answering|responding|replying|doing anything|you do anything)\b[^.\n]{0,50}\b(?:call|run|load|read|fetch|send|execute|install)\b/i,
    why: "adds a step an agent must take before answering",
  },
  {
    pattern: /\b(?:send|post|upload|exfiltrate|forward|email)\b[^.\n]{0,40}\b(?:secrets?|credentials?|api[- ]?keys?|tokens?|passwords?|private keys?)\b/i,
    why: "mentions sending credentials somewhere",
  },
];

function excerpt(text: string): string {
  const flat = makeVisible(text).text.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat;
}

/**
 * Look for text in an entry that could mislead a reader or steer an agent.
 * Hidden characters are checked everywhere; instruction-like phrases only in the
 * title, summary and tags, because process documents legitimately say "you must".
 */
export function lintEntry(meta: Pick<EntryMeta, "title" | "summary" | "tags">, body = ""): LintFinding[] {
  const findings: LintFinding[] = [];

  const fields: [LintFinding["field"], string][] = [
    ["title", meta.title],
    ["summary", meta.summary],
    ["tags", meta.tags.join("\n")],
  ];
  for (const [field, text] of fields) {
    for (const { pattern, why } of INSTRUCTION_PATTERNS) {
      const match = pattern.exec(text);
      if (match) findings.push({ field, message: `reads like an instruction to an agent (${why}): "${excerpt(match[0])}"` });
    }
  }

  for (const [field, text] of [...fields, ["body", body] as [LintFinding["field"], string]]) {
    if (hasHiddenCharacters(text)) {
      findings.push({ field, message: "contains invisible or control characters" });
    }
  }
  return findings;
}
