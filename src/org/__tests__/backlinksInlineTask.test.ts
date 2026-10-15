/**
 * Backlinks CodeLens and references must not treat inline tasks as headings
 * (issue #60): the `*************** END` line used to become a heading titled
 * "END" and collect every [[end]] link in the index.
 */
import { describe, it, expect, vi } from 'vitest';
import { isHeadingLine } from '../../parser/orgHeadingLine';

// The index holds one [[end]] link in a.org, and one [[Some heading]] link.
const LINKS: Record<string, { file_path: string; line_number: number }> = {
    'end': { file_path: '/a.org', line_number: 2 },
    'some heading': { file_path: '/a.org', line_number: 3 },
};

vi.mock('../../database/lazyDb', () => ({
    getDatabase: async () => ({
        getBacklinksBatch: async (targets: { kind: string; title?: string }[]) =>
            targets.map(t => {
                const row = t.kind === 'heading' && t.title ? LINKS[t.title.toLowerCase()] : undefined;
                return row ? [{ ...row, description: null, heading_title: null }] : [];
            }),
        getHeadingBacklinks: async (t: { title?: string }) => {
            const row = t.title ? LINKS[t.title.toLowerCase()] : undefined;
            return row ? [{ ...row, description: null, heading_title: null }] : [];
        },
    }),
}));

const registered: { codeLens?: any; refs?: any } = {};

vi.mock('vscode', () => {
    class Position { constructor(public line: number, public character: number) {} }
    class Range { constructor(public startLine: number, public sc: number, public endLine: number, public ec: number) {} }
    class CodeLens { constructor(public range: Range, public command: unknown) {} }
    class Location { constructor(public uri: unknown, public pos: Position) {} }
    class EventEmitter { event = () => ({ dispose() {} }); fire() {} }
    return {
        Position, Range, CodeLens, Location, EventEmitter,
        Uri: { file: (p: string) => ({ fsPath: p }) },
        workspace: {
            getConfiguration: () => ({ get: (_k: string, d: unknown) => d }),
            onDidSaveTextDocument: () => ({ dispose() {} }),
            onDidChangeConfiguration: () => ({ dispose() {} }),
        },
        languages: {
            registerReferenceProvider: (_s: unknown, p: unknown) => { registered.refs = p; return { dispose() {} }; },
            registerCodeLensProvider: (_s: unknown, p: unknown) => { registered.codeLens = p; return { dispose() {} }; },
        },
    };
});

import { registerBacklinksProvider } from '../backlinksProvider';
registerBacklinksProvider({ subscriptions: [] } as any);

const STARS = '*'.repeat(15);
const TEXT = [
    '* Some heading',
    '',
    `${STARS} TODO followup on something`,
    'DEADLINE: <2026-10-21 Wed>',
    'body text',
    `${STARS} END`,
    'after the task',
].join('\n');

function doc(text: string) {
    const lines = text.split('\n');
    return {
        languageId: 'org',
        fileName: '/b.org',
        version: 1,
        uri: { toString: () => 'file:///b.org', fsPath: '/b.org' },
        getText: () => text,
        lineAt: (i: number) => ({ text: lines[i] }),
    };
}

describe('isHeadingLine', () => {
    it('accepts headings below the inline task level', () => {
        expect(isHeadingLine('* A')).toBe(true);
        expect(isHeadingLine(`${'*'.repeat(14)} Deep`)).toBe(true);
    });
    it('rejects inline task lines and non-headings', () => {
        expect(isHeadingLine(`${STARS} TODO task`)).toBe(false);
        expect(isHeadingLine(`${STARS} END`)).toBe(false);
        expect(isHeadingLine('*bold* text')).toBe(false);
        expect(isHeadingLine(' * list')).toBe(false);
    });
    it('honors a custom inline task level', () => {
        expect(isHeadingLine('**** Task', 4)).toBe(false);
        expect(isHeadingLine('*** Heading', 4)).toBe(true);
    });
});

describe('backlinks with inline tasks', () => {
    it('puts no CodeLens on an inline task opening or END line', async () => {
        const lenses = await registered.codeLens.provideCodeLenses(doc(TEXT));
        const lines = lenses.map((l: any) => l.range.startLine);
        expect(lines).toEqual([0]); // only "* Some heading"
    });

    it('resolves references inside an inline task to the enclosing heading', async () => {
        for (const line of [2, 5, 6]) {
            const locs = await registered.refs.provideReferences(doc(TEXT), { line, character: 0 });
            expect(locs).toHaveLength(1);
            expect(locs[0].pos.line).toBe(2); // the [[Some heading]] link, line 3 in a.org
        }
    });
});
