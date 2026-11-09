/**
 * Comma escapes in org blocks.
 *
 * Inside src, example and export blocks, org writes a comma before a line
 * that would otherwise read as org syntax: `,* Heading`, `,#+begin_src`.
 * The comma is not part of the block's contents. Emacs removes it when a
 * block is exported, run or tangled (`org-unescape-code-in-string`), and adds
 * it back when contents are written into a block (`org-escape-code-in-string`).
 *
 * Only one comma is removed, so `,,* x` stands for the text `,* x`.
 */

const ESCAPED = /^([ \t]*,*),(?=\*|#\+)/gm;
const NEEDS_ESCAPE = /^([ \t]*)(?=,*(?:\*|#\+))/gm;

/** The contents of a block as text: one escaping comma removed per line */
export function unescapeOrgCode(text: string): string {
    if (!text.includes(',')) return text;
    return text.replace(ESCAPED, '$1');
}

/** Text ready to write inside a block: lines starting with `*` or `#+` get a comma */
export function escapeOrgCode(text: string): string {
    return text.replace(NEEDS_ESCAPE, '$1,');
}
