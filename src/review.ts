import { diffLines } from "./diff.js";
import { serializeEntry } from "./frontmatter.js";
import type { KnowledgeBase } from "./kb.js";
import { lintEntry } from "./lint.js";
import type { Proposal } from "./proposals.js";
import { makeVisible } from "./sanitize.js";

const INDENT = "           ";

function indented(text: string): string {
  return text.replace(/\n/g, `\n${INDENT}`);
}

function list(values: string[]): string {
  return `[${values.join(", ")}]`;
}

/**
 * Things a reviewer should look at before approving. These are prompts to look
 * closer, not verdicts: Pocket cannot tell whether a claim is true.
 */
export function reviewNotes(kb: KnowledgeBase, proposal: Proposal): string[] {
  const notes: string[] = [];
  const { meta, body } = proposal.entry;
  const current = proposal.action === "update" ? kb.getEntry(proposal.entryId) : undefined;

  if (proposal.action === "add") {
    if (meta.source === undefined) notes.push("No source is stated for this knowledge. Ask where it came from.");
    else if (/^https?:\/\//i.test(meta.source) && meta.license === undefined) {
      notes.push("The source is a link but no license is stated. Check that you may reuse it.");
    }
  }

  const tools = meta.extra["allowed-tools"];
  if (tools !== undefined) notes.push(`Declares pre-approved tools (allowed-tools: ${String(tools)}). Check each one.`);

  for (const finding of lintEntry(meta, body)) notes.push(`${finding.field} ${finding.message}`);

  if (current) {
    // Title, summary and tags are what search and agents see first, so changes there matter most.
    if (current.title !== meta.title) notes.push(`Search-visible change: title was "${current.title}", now "${meta.title}".`);
    if (current.summary !== meta.summary) notes.push(`Search-visible change: summary was "${current.summary}", now "${meta.summary}".`);
    if (list(current.tags) !== list(meta.tags)) notes.push(`Search-visible change: tags were ${list(current.tags)}, now ${list(meta.tags)}.`);
    if (current.source !== meta.source) notes.push(`Provenance change: source was ${current.source ?? "(none)"}, now ${meta.source ?? "(none)"}.`);
    if (current.license !== meta.license) notes.push(`Provenance change: license was ${current.license ?? "(none)"}, now ${meta.license ?? "(none)"}.`);
  }
  return notes;
}

/**
 * The text a person reads when reviewing a proposal. Everything is passed through
 * makeVisible, so an agent cannot use escape sequences or invisible characters to
 * change what the reviewer sees.
 */
export function renderProposal(kb: KnowledgeBase, proposal: Proposal): string {
  const { meta, body } = proposal.entry;
  const lines: string[] = [
    `Proposal   ${proposal.proposalId} (${proposal.state})`,
    `Action     ${proposal.action} entry "${proposal.entryId}" in scope "${proposal.scope}"`,
    `Proposed   by ${proposal.proposedBy} at ${proposal.createdAt}`,
    `Rationale  ${indented(proposal.rationale)}`,
  ];
  if (proposal.decisionNote) lines.push(`Decision   ${indented(proposal.decisionNote)}`);

  lines.push(`Source     ${meta.source !== undefined ? indented(meta.source) : "(none stated)"}`);
  lines.push(`License    ${meta.license ?? "(none stated)"}`);
  if (meta.sourceHash) lines.push(`Hash       ${meta.sourceHash}`);
  if (proposal.evidence) {
    lines.push("Evidence   (written by the proposer; Pocket has not checked it)");
    for (const key of ["task", "outcome", "link"] as const) {
      const value = proposal.evidence[key];
      if (value !== undefined) lines.push(`${INDENT}${key}: ${indented(value)}`);
    }
  } else {
    lines.push("Evidence   (none attached)");
  }

  const notes = reviewNotes(kb, proposal);
  if (notes.length > 0) {
    lines.push("", "Look closely at:");
    for (const note of notes) lines.push(`  - ${indented(note)}`);
  }
  lines.push("");

  const current = kb.getEntry(proposal.entryId);
  const proposedMeta = serializeEntry(meta, "").trimEnd();
  if (proposal.action === "add" || !current) {
    lines.push(proposedMeta, "", body);
  } else {
    const metaChanges = diffLines(serializeEntry(current, "").trimEnd(), proposedMeta).filter((l) => !l.startsWith(" "));
    const bodyChanges = diffLines(current.body.trim(), body).filter((l) => !l.startsWith(" "));
    lines.push(`Changes against version ${current.version}:`);
    lines.push(metaChanges.length > 0 ? metaChanges.join("\n") : "(no metadata changes)");
    lines.push("");
    lines.push(bodyChanges.length > 0 ? bodyChanges.join("\n") : "(no body changes)");
  }

  const visible = makeVisible(lines.join("\n"));
  if (visible.replaced === 0) return visible.text;
  return `${visible.text}\n\nNote: ${visible.replaced} hidden or control character(s) in this proposal were replaced with \\u{...} markers so they cannot hide anything.`;
}
