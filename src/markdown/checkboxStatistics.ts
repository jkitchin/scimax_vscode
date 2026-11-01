/**
 * Statistics cookies ([n/m] or [n%]) for checkboxes in Markdown.
 *
 *   ## Checkboxes [2/3]
 *   - [x] task 1
 *   - [x] task 2
 *   - [ ] task 3
 *
 * A cookie on a heading counts every checkbox in the heading's own section
 * (up to the next heading of any level), as the org side does. A cookie on a
 * list item counts the item's direct child checkboxes; after it changes, the
 * cookies above it are updated in turn.
 *
 * Pure: no vscode imports.
 */

import { markdownFencedLineMask } from '../shared/markdownFences';

const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const LIST_ITEM = /^(\s*)([-+*]|\d+[.)])\s+/;
const CHECKBOX = /^(\s*)([-+*]|\d+[.)])\s+\[([ xX-])\]/;
const COOKIE = /\[(\d+)\/(\d+)\]|\[(\d+)%\]/;

export interface LineEdit {
    line: number;
    text: string;
}

function indentOf(line: string): number {
    return (line.match(/^\s*/)?.[0] ?? '').replace(/\t/g, '    ').length;
}

/** The new text of a line's cookie for `done` of `total`. */
export function replaceCookie(text: string, done: number, total: number): string {
    return text.replace(COOKIE, (_m, _a, _b, pct) =>
        pct !== undefined
            ? `[${total === 0 ? 0 : Math.round((done / total) * 100)}%]`
            : `[${done}/${total}]`);
}

/** The line holding the cookie that counts the checkbox (or item) on `line`, or -1. */
function cookieParent(lines: string[], inFence: boolean[], line: number): number {
    let indent = indentOf(lines[line]);
    const isHeading = HEADING.test(lines[line]) && !inFence[line];
    if (isHeading) return -1;
    for (let i = line - 1; i >= 0; i--) {
        if (inFence[i]) continue;
        const text = lines[i];
        if (HEADING.test(text)) return COOKIE.test(text) ? i : -1;
        if (LIST_ITEM.test(text) && indentOf(text) < indent) {
            if (COOKIE.test(text)) return i;
            // An ancestor without a cookie: keep looking above it only.
            indent = indentOf(text);
        }
    }
    return -1;
}

/** The [checked, total] count for the cookie on `parent`. */
function countFor(lines: string[], inFence: boolean[], parent: number): [number, number] {
    const isHeading = HEADING.test(lines[parent]);
    const parentIndent = indentOf(lines[parent]);
    let childIndent = -1;
    let done = 0;
    let total = 0;
    for (let i = parent + 1; i < lines.length; i++) {
        if (inFence[i]) continue;
        const text = lines[i];
        if (HEADING.test(text)) break;
        if (!isHeading) {
            if (text.trim() === '') continue;
            // The item ends at a line indented no more than it.
            if (indentOf(text) <= parentIndent) break;
        }
        const box = CHECKBOX.exec(text);
        if (!box) continue;
        if (!isHeading) {
            // Direct children only: the first child's indent sets the level.
            const ind = indentOf(text);
            if (childIndent < 0) childIndent = ind;
            if (ind !== childIndent) continue;
        }
        total++;
        if (box[3].toLowerCase() === 'x') done++;
    }
    return [done, total];
}

/**
 * The edits that bring the cookies counting `line` up to date: the cookie
 * on its parent heading or list item, then that parent's parents. When `line`
 * itself holds a cookie (C-c C-c on it), that cookie is updated first.
 */
export function checkboxCookieEdits(content: string | string[], line: number): LineEdit[] {
    const lines = typeof content === 'string' ? content.split('\n') : [...content];
    if (line < 0 || line >= lines.length) return [];
    const inFence = markdownFencedLineMask(lines);
    const edits: LineEdit[] = [];
    const update = (target: number) => {
        const [done, total] = countFor(lines, inFence, target);
        const text = replaceCookie(lines[target], done, total);
        if (text !== lines[target]) {
            lines[target] = text;
            edits.push({ line: target, text });
        }
    };
    if (!inFence[line] && COOKIE.test(lines[line]) && (HEADING.test(lines[line]) || LIST_ITEM.test(lines[line]))) {
        update(line);
    }
    let current = line;
    for (let guard = 0; guard < 100; guard++) {
        const parent = cookieParent(lines, inFence, current);
        if (parent < 0) break;
        update(parent);
        current = parent;
    }
    return edits;
}

/** True for a heading or list item line holding a statistics cookie. */
export function isCookieLine(text: string): boolean {
    return COOKIE.test(text) && (HEADING.test(text) || LIST_ITEM.test(text));
}
