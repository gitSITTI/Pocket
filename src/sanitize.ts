/**
 * Characters that can hide or rewrite text when it is shown to a person:
 * control characters (including escape sequences and carriage returns), C1 controls,
 * zero-width and direction-changing marks, the byte order mark, and the Unicode
 * "tag" block that can smuggle invisible ASCII.
 *
 * Tab, newline, the joiners U+200C and U+200D (legitimate in emoji and several
 * scripts) and ordinary text are left alone.
 */
const HIDDEN_CLASS = String.raw`\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​‎‏‪-‮⁠-⁤⁦-⁩﻿\u{E0000}-\u{E007F}`;

/** Matches hidden characters but not a carriage return, so CRLF files are not flagged. */
const HIDDEN_IN_FILE = new RegExp(`[${HIDDEN_CLASS}]`, "u");

/** Matches everything above plus carriage returns, which can overwrite a terminal line. */
const HIDDEN_ON_SCREEN = new RegExp(`[${HIDDEN_CLASS}\\r]`, "gu");

/** True when the text contains characters that could hide content from a reader. */
export function hasHiddenCharacters(text: string): boolean {
  return HIDDEN_IN_FILE.test(text);
}

export interface VisibleText {
  text: string;
  /** How many characters were replaced. */
  replaced: number;
}

/**
 * Replace hidden characters with a visible \u{...} marker, so text written by an
 * agent cannot clear the screen, move the cursor or hide words in a review.
 */
export function makeVisible(text: string): VisibleText {
  let replaced = 0;
  const result = text.replace(HIDDEN_ON_SCREEN, (char) => {
    replaced += 1;
    return `\\u{${char.codePointAt(0)!.toString(16)}}`;
  });
  return { text: result, replaced };
}
