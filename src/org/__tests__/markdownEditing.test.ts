/**
 * Markdown behavior of org editing commands: heading detection skips code
 * blocks, Enter and markup write markdown, subtree moves keep code intact.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ editor: undefined as any, commands: [] as string[] }));

vi.mock('vscode', () => {
    class Position {
        constructor(public line: number, public character: number) {}
        translate(dl: number, dc: number) { return new Position(this.line + dl, this.character + dc); }
    }
    class Range {
        start: any; end: any;
        constructor(a: any, b: any, c?: any, d?: any) {
            if (typeof a === 'number') { this.start = new Position(a, b); this.end = new Position(c, d); }
            else { this.start = a; this.end = b; }
        }
    }
    class Selection extends Range {
        constructor(public anchor: any, public active: any) { super(anchor, active); }
        get isEmpty() { return this.anchor.line === this.active.line && this.anchor.character === this.active.character; }
    }
    class SnippetString { constructor(public value: string) {} }
    const handler: ProxyHandler<any> = {
        get: (target, prop) => {
            if (prop in target) return target[prop];
            if (prop === 'then') return undefined;
            return new Proxy(function () { return new Proxy({}, handler); }, handler);
        },
        apply: () => new Proxy({}, handler),
        construct: () => new Proxy({}, handler),
        has: () => true,
    };
    const base: any = {
        Position, Range, Selection, SnippetString,
        window: new Proxy({
            get activeTextEditor() { return state.editor; },
            showInformationMessage: vi.fn(),
            showWarningMessage: vi.fn(),
        }, handler),
        workspace: new Proxy({
            getConfiguration: () => ({ get: (_k: string, d: any) => d }),
        }, handler),
        commands: new Proxy({
            executeCommand: async (cmd: string) => { state.commands.push(cmd); },
            registerCommand: () => ({ dispose() {} }),
        }, handler),
    };
    return new Proxy(base, handler);
});

import { boldRegionOrPoint, italicRegionOrPoint, strikethroughRegionOrPoint, dwimReturn, dwimComment } from '../scimaxOrg';
import { isAtHeadingStart, getHeadingLevel } from '../speedCommands/context';
import { demoteSubtree, moveHeadingDown } from '../headingProvider';

/** A minimal editable document/editor pair over a list of lines */
function makeEditor(text: string, languageId: string, line = 0, character = 0) {
    let lines = text.split('\n');
    const offsetOf = (p: any) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + Math.min(p.character, lines[p.line]?.length ?? 0);
    const doc: any = {
        languageId,
        version: 1,
        get lineCount() { return lines.length; },
        getText: (r?: any) => r ? lines.join('\n').slice(offsetOf(r.start), offsetOf(r.end)) : lines.join('\n'),
        lineAt: (n: number) => ({
            lineNumber: n,
            text: lines[n],
            range: { start: { line: n, character: 0 }, end: { line: n, character: lines[n].length } },
            rangeIncludingLineBreak: { start: { line: n, character: 0 }, end: { line: n + 1, character: 0 } },
        }),
        getWordRangeAtPosition: (p: any) => {
            const t = lines[p.line];
            let s = p.character, e = p.character;
            while (s > 0 && /\w/.test(t[s - 1])) s--;
            while (e < t.length && /\w/.test(t[e])) e++;
            return s === e ? undefined : { start: { line: p.line, character: s }, end: { line: p.line, character: e } };
        },
        uri: { fsPath: '/tmp/x.md', toString: () => 'file:///tmp/x.md' },
    };
    const sel = (l: number, c: number) => ({ active: { line: l, character: c }, anchor: { line: l, character: c }, start: { line: l, character: c }, end: { line: l, character: c }, isEmpty: true });
    const editor: any = {
        document: doc,
        selection: sel(line, character),
        edit: async (cb: any) => {
            const edits: { s: number; e: number; t: string }[] = [];
            cb({
                replace: (r: any, t: string) => edits.push({ s: offsetOf(r.start), e: offsetOf(r.end), t }),
                insert: (p: any, t: string) => edits.push({ s: offsetOf(p), e: offsetOf(p), t }),
                delete: (r: any) => edits.push({ s: offsetOf(r.start), e: r.end.line >= lines.length ? lines.join('\n').length : offsetOf(r.end), t: '' }),
            });
            let full = lines.join('\n');
            for (const ed of edits.sort((a, b) => b.s - a.s)) full = full.slice(0, ed.s) + ed.t + full.slice(ed.e);
            lines = full.split('\n');
            doc.version++;
            return true;
        },
        insertSnippet: async () => true,
        revealRange: () => {},
    };
    return { editor, doc, text: () => lines.join('\n') };
}

beforeEach(() => { state.editor = undefined; state.commands = []; });

const FENCED = '# Intro\n\n```python\n# a comment\nx = 1\n```\n\n## Sub\ntext\n# Next\n';

describe('heading detection skips markdown code', () => {
    it('speed keys are not active on a # comment inside a code block', () => {
        const { doc } = makeEditor(FENCED, 'markdown');
        expect(isAtHeadingStart(doc, { line: 0, character: 0 } as any)).toBe(true);
        expect(isAtHeadingStart(doc, { line: 3, character: 0 } as any)).toBe(false);
        expect(getHeadingLevel(doc, 3)).toBe(0);
        expect(getHeadingLevel(doc, 7)).toBe(2);
    });

    it('front matter # lines are not headings', () => {
        const { doc } = makeEditor('---\n# yaml\n---\n# Title', 'markdown');
        expect(getHeadingLevel(doc, 1)).toBe(0);
        expect(getHeadingLevel(doc, 3)).toBe(1);
    });

    it('demote subtree demotes headings after the code block, not the comment', async () => {
        const e = makeEditor(FENCED, 'markdown', 0);
        state.editor = e.editor;
        await demoteSubtree();
        expect(e.text()).toBe('## Intro\n\n```python\n# a comment\nx = 1\n```\n\n### Sub\ntext\n# Next\n');
    });

    it('move subtree down keeps the code block inside its section', async () => {
        const e = makeEditor('# A\n```\n# c\n```\n# B\nb\n', 'markdown', 0);
        state.editor = e.editor;
        await moveHeadingDown();
        // The whole # A section, code block included, moved below # B
        expect(e.text().startsWith('# B\nb\n')).toBe(true);
        expect(e.text()).toContain('# A\n```\n# c\n```');
    });
});

describe('DWIM return in markdown', () => {
    it('leaves lines inside code blocks to the normal newline', async () => {
        for (const line of ['| not a table', '- a: 1']) {
            const e = makeEditor('```yaml\n' + line + '\n```', 'markdown', 1, line.length);
            state.editor = e.editor;
            expect(await dwimReturn()).toBe(false);
            expect(e.text()).toBe('```yaml\n' + line + '\n```');
        }
    });

    it('does not delete a line that only starts with |', async () => {
        const e = makeEditor('| not a table', 'org', 0, 5);
        state.editor = e.editor;
        await dwimReturn();
        expect(e.text()).toContain('| not a table');
    });

    it('treats * at column 0 as a list bullet', async () => {
        const e = makeEditor('* apple', 'markdown', 0, 7);
        state.editor = e.editor;
        expect(await dwimReturn()).toBe(true);
        expect(e.text()).toBe('* apple\n* ');
    });
});

describe('markup and comments in markdown', () => {
    it('wraps words in markdown markers', async () => {
        for (const [fn, expected] of [
            [boldRegionOrPoint, '**word**'],
            [italicRegionOrPoint, '*word*'],
            [strikethroughRegionOrPoint, '~~word~~'],
        ] as const) {
            const e = makeEditor('word', 'markdown', 0, 1);
            state.editor = e.editor;
            await fn();
            expect(e.text()).toBe(expected);
        }
    });

    it('keeps org markers in org files', async () => {
        const e = makeEditor('word', 'org', 0, 1);
        state.editor = e.editor;
        await boldRegionOrPoint();
        expect(e.text()).toBe('*word*');
    });

    it('comments with the editor comment command instead of # ', async () => {
        const e = makeEditor('Some paragraph', 'markdown', 0, 0);
        state.editor = e.editor;
        await dwimComment();
        expect(e.text()).toBe('Some paragraph');
        expect(state.commands).toContain('editor.action.commentLine');
    });
});
