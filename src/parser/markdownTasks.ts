/**
 * Org-style tasks in Markdown headings.
 *
 *   ## TODO [#A] Write the intro #paper
 *   SCHEDULED: <2026-11-03 Tue> DEADLINE: <2026-11-07 Fri>
 *
 * A heading may start with a TODO keyword (bare, or in brackets as
 * `[TODO]`), then a priority cookie. Tags are `#tag` words or an org
 * `:a:b:` group at the end of the title. A planning line with SCHEDULED,
 * DEADLINE and CLOSED timestamps may follow the heading directly.
 *
 * Keywords are the defaults (TODO, NEXT, WAIT, ... DONE, CANCELLED) plus any
 * declared with `#+TODO: A B | C`, written either as a line of its own or
 * inside an HTML comment (`<!-- #+TODO: A B | C -->`) so it does not render.
 *
 * Pure: no vscode imports, so the database and the CLI can use it.
 */

import { markdownFencedLineMask } from '../shared/markdownFences';

/** Same list as DEFAULT_TODO_STATES in src/org/todoStates.ts. */
const DEFAULT_ACTIVE = ['TODO', 'NEXT', 'WAIT', 'WAITING', 'HOLD', 'SOMEDAY', 'IN-PROGRESS'];
const DEFAULT_DONE = ['DONE', 'CANCELLED', 'CANCELED'];

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const KEYWORD_LINE_RE = /^\s*(?:<!--\s*)?#\+(?:TODO|SEQ_TODO|TYP_TODO):\s*(.*?)\s*(?:-->)?\s*$/i;

export interface MarkdownTaskKeywords {
    active: Set<string>;
    done: Set<string>;
}

export interface MarkdownHeading {
    level: number;
    title: string;
    /** 1-based line number */
    lineNumber: number;
    /** Character offset of the heading line */
    beginPos: number;
    todoState: string | null;
    todoType: 'todo' | 'done' | null;
    priority: string | null;
    tags: string[];
    scheduled: string | null;
    deadline: string | null;
    closed: string | null;
}

/** TODO keywords for a Markdown document: the defaults plus any #+TODO lines. */
export function markdownTodoKeywords(content: string): MarkdownTaskKeywords {
    const active = new Set(DEFAULT_ACTIVE);
    const done = new Set(DEFAULT_DONE);
    for (const line of content.split('\n')) {
        const m = KEYWORD_LINE_RE.exec(line);
        if (!m || !m[1]) continue;
        // Strip fast-access keys: TODO(t) -> TODO
        const clean = (s: string) => s.split(/\s+/).map(w => w.replace(/\(.*\)$/, '')).filter(w => w && w !== '|');
        const pipe = m[1].lastIndexOf('|');
        let a: string[];
        let d: string[];
        if (pipe >= 0) {
            a = clean(m[1].slice(0, pipe));
            d = clean(m[1].slice(pipe + 1));
        } else {
            const all = clean(m[1]);
            a = all.length > 1 ? all.slice(0, -1) : all;
            d = all.length > 1 ? all.slice(-1) : [];
        }
        for (const s of a) { active.add(s); done.delete(s); }
        for (const s of d) { done.add(s); active.delete(s); }
    }
    return { active, done };
}

const PLANNING_LINE_RE = /^\s*(?:SCHEDULED|DEADLINE|CLOSED):/;

/** True for a line holding SCHEDULED / DEADLINE / CLOSED timestamps. */
export function isPlanningLine(line: string): boolean {
    return PLANNING_LINE_RE.test(line);
}

/** The timestamps on a planning line (without brackets). */
export function parsePlanningLine(line: string): { scheduled: string | null; deadline: string | null; closed: string | null } {
    return {
        scheduled: line.match(/SCHEDULED:\s*<(\d{4}-\d{2}-\d{2}[^>]*)>/)?.[1] ?? null,
        deadline: line.match(/DEADLINE:\s*<(\d{4}-\d{2}-\d{2}[^>]*)>/)?.[1] ?? null,
        closed: line.match(/CLOSED:\s*\[(\d{4}-\d{2}-\d{2}[^\]]*)\]/)?.[1] ?? null,
    };
}

interface SplitTitle {
    todoState: string | null;
    bracketed: boolean;
    priority: string | null;
    title: string;
    tags: string[];
}

function splitHeadingText(text: string, keywords: MarkdownTaskKeywords): SplitTitle {
    let rest = text.trim();
    let todoState: string | null = null;
    let bracketed = false;

    const bracket = /^\[([A-Z][A-Z0-9_-]*)\](?:\s+|$)/.exec(rest);
    if (bracket && !/^\[#/.test(rest)) {
        todoState = bracket[1];
        bracketed = true;
        rest = rest.slice(bracket[0].length);
    } else {
        const sp = rest.search(/\s/);
        const first = sp === -1 ? rest : rest.slice(0, sp);
        if (keywords.active.has(first) || keywords.done.has(first)) {
            todoState = first;
            rest = sp === -1 ? '' : rest.slice(sp).trimStart();
        }
    }

    let priority: string | null = null;
    const pri = /^\[#([A-Z0-9])\](?:\s+|$)/.exec(rest);
    if (pri) {
        priority = pri[1];
        rest = rest.slice(pri[0].length);
    }

    const tags: string[] = [];
    const orgTags = /\s+:([\w@#%-]+(?::[\w@#%-]+){0,49}):\s*$/.exec(' ' + rest);
    if (orgTags) {
        tags.push(...orgTags[1].split(':'));
        rest = (' ' + rest).slice(0, orgTags.index).trim();
    }
    const hashTags = /(?:^|\s+)#([\w-]+(?:\s+#[\w-]+)*)\s*$/.exec(rest);
    if (hashTags) {
        tags.push(...hashTags[1].split(/\s+#/));
        rest = rest.slice(0, hashTags.index).trim();
    }

    return { todoState, bracketed, priority, title: rest.trim(), tags };
}

/** The headings of a Markdown document, with their task metadata. */
export function parseMarkdownHeadings(content: string, keywords = markdownTodoKeywords(content)): MarkdownHeading[] {
    const lines = content.split('\n');
    const inFence = markdownFencedLineMask(lines);
    const headings: MarkdownHeading[] = [];
    let pos = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = inFence[i] ? null : HEADING_RE.exec(line);
        if (m) {
            const parts = splitHeadingText(m[2], keywords);
            const state = parts.todoState;
            let planning = { scheduled: null as string | null, deadline: null as string | null, closed: null as string | null };
            const next = lines[i + 1];
            if (next !== undefined && !inFence[i + 1] && isPlanningLine(next)) {
                planning = parsePlanningLine(next);
            }
            headings.push({
                level: m[1].length,
                title: parts.title,
                lineNumber: i + 1,
                beginPos: pos,
                todoState: state,
                todoType: state ? (keywords.done.has(state) ? 'done' : 'todo') : null,
                priority: parts.priority,
                tags: parts.tags,
                ...planning,
            });
        }
        pos += line.length + 1;
    }
    return headings;
}

/**
 * The document rewritten as an org outline with the same lines: `#`
 * headings become `*` headings (`[TODO]` becomes `TODO`, `#tags` become
 * `:tags:`), and everything else that could look like org syntax (fenced
 * code, other lines starting with `*`) is blanked. Line numbers match the
 * Markdown file, so the org agenda code can read Markdown files.
 */
export function markdownToOrgOutline(content: string): string {
    const keywords = markdownTodoKeywords(content);
    const lines = content.split('\n');
    const inFence = markdownFencedLineMask(lines);
    const out: string[] = [];
    // Declare the document's keywords so the org parser recognises them.
    const declared = `#+TODO: ${[...keywords.active].join(' ')} | ${[...keywords.done].join(' ')}`;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (inFence[i]) { out.push(''); continue; }
        const m = HEADING_RE.exec(line);
        if (m) {
            const p = splitHeadingText(m[2], keywords);
            const parts = ['*'.repeat(m[1].length)];
            if (p.todoState) parts.push(p.todoState);
            if (p.priority) parts.push(`[#${p.priority}]`);
            if (p.title) parts.push(p.title);
            if (p.tags.length) parts.push(`:${p.tags.join(':')}:`);
            out.push(parts.join(' '));
        } else if (isPlanningLine(line)) {
            out.push(line.trimStart());
        } else if (/^\s*(?:\*|#\+)/.test(line)) {
            // `* item` lists and keyword lines would read as org syntax.
            out.push('');
        } else {
            out.push(line);
        }
    }
    // Put the keyword line before the first heading, replacing a line there
    // (text before the first heading never reaches the agenda).
    const firstHeading = out.findIndex(l => /^\*+\s/.test(l));
    if (firstHeading !== 0 && out.length > 0) out[0] = declared;
    return out.join('\n');
}

/** True for a Markdown file path. */
export function isMarkdownPath(filePath: string): boolean {
    return /\.(md|markdown|qmd)$/i.test(filePath);
}

/** Regex for a heading line: `#` headings in Markdown, `*` headings in org. */
export function headingLineRegex(markdown: boolean): RegExp {
    return markdown ? /^(#{1,6})\s/ : /^(\*+)\s/;
}

export type MarkdownTaskTokenKind = 'todo' | 'done' | 'priority' | 'tag' | 'planning' | 'timestamp' | 'inactiveTimestamp';

export interface MarkdownTaskToken {
    /** 0-based line */
    line: number;
    start: number;
    length: number;
    kind: MarkdownTaskTokenKind;
}

/**
 * The parts of Markdown task headings and planning lines to colour as in
 * org: the TODO keyword (bare or `[TODO]`), the `[#A]` priority, a `:a:b:`
 * tag group, and on the planning line under a heading, its keywords and
 * timestamps. Fenced code is skipped. Sorted by position.
 */
export function markdownTaskTokens(content: string, keywords = markdownTodoKeywords(content)): MarkdownTaskToken[] {
    const lines = content.split('\n');
    const inFence = markdownFencedLineMask(lines);
    const tokens: MarkdownTaskToken[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (inFence[i]) continue;
        const line = lines[i].replace(/\r$/, '');
        const marks = /^(#{1,6})[ \t]+/.exec(line);
        if (marks) {
            let pos = marks[0].length;
            const rest = line.slice(pos);
            const kw = /^(\[)?([A-Z][A-Z0-9_-]*)(\])?(?=\s|$)/.exec(rest);
            if (kw && (!!kw[1] === !!kw[3]) && (keywords.active.has(kw[2]) || keywords.done.has(kw[2]))) {
                tokens.push({ line: i, start: pos, length: kw[0].length, kind: keywords.done.has(kw[2]) ? 'done' : 'todo' });
                pos += kw[0].length;
                pos += /^\s*/.exec(line.slice(pos))![0].length;
            }
            const pri = /^\[#[A-Z0-9]\](?=\s|$)/.exec(line.slice(pos));
            if (pri) tokens.push({ line: i, start: pos, length: pri[0].length, kind: 'priority' });
            const tags = /\s(:[\w@#%-]+(?::[\w@#%-]+){0,49}:)\s*$/.exec(line);
            if (tags) {
                const start = tags.index + 1;
                if (start > pos) tokens.push({ line: i, start, length: tags[1].length, kind: 'tag' });
            }
            continue;
        }
        if (isPlanningLine(line) && i > 0 && !inFence[i - 1] && /^#{1,6}[ \t]/.test(lines[i - 1])) {
            const re = /(SCHEDULED|DEADLINE|CLOSED):|<\d{4}-\d{2}-\d{2}[^>\n]*>|\[\d{4}-\d{2}-\d{2}[^\]\n]*\]/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(line))) {
                const kind: MarkdownTaskTokenKind = m[1] ? 'planning' : m[0][0] === '<' ? 'timestamp' : 'inactiveTimestamp';
                tokens.push({ line: i, start: m.index, length: m[0].length, kind });
            }
        }
    }
    return tokens;
}
