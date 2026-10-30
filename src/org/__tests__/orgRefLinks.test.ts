/**
 * ref:label links are clickable: bare (also inside table cells, with
 * trailing punctuation dropped) and as [[ref:label]] org links.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => {
    class Range { constructor(public startLine: number, public startChar: number, public endLine?: number, public endChar?: number) {} }
    class DocumentLink {
        target?: { toString(): string };
        tooltip?: string;
        constructor(public range: Range) {}
    }
    return {
        Range,
        DocumentLink,
        Uri: { parse: (value: string) => ({ value, toString: () => value }) },
        workspace: {},
        window: {},
        commands: {},
    };
});
vi.mock('../../database/lazyDb', () => ({ getDatabase: vi.fn() }));

import { OrgLinkProvider } from '../orgLinkProvider';
import { findBareRefs, findLabelLine } from '../../references/refLinks';

function refLinks(text: string): { args: any }[] {
    const document = {
        uri: { fsPath: '/docs/notes.org' },
        getText: () => text,
        positionAt: (offset: number) => offset,
    };
    return new OrgLinkProvider().provideDocumentLinks(document as any, {} as any)
        .map(link => decodeURIComponent(link.target?.toString() ?? ''))
        .filter(uri => uri.startsWith('command:scimax.ref.gotoLabel'))
        .map(uri => ({ args: JSON.parse(uri.slice(uri.indexOf('?') + 1)) }));
}

describe('findBareRefs', () => {
    it('drops trailing sentence punctuation', () => {
        const line = 'The data is in ref:table-data.';
        const [ref] = findBareRefs(line);
        expect(ref.label).toBe('table-data');
        expect(line.slice(ref.start, ref.end)).toBe('ref:table-data');
    });

    it('finds refs in table cells', () => {
        const refs = findBareRefs('| see ref:table-data | eqref:eq-1|');
        expect(refs.map(r => [r.type, r.label])).toEqual([['ref', 'table-data'], ['eqref', 'eq-1']]);
    });

    it('keeps colons inside labels', () => {
        expect(findBareRefs('ref:tab:flows, and more')[0].label).toBe('tab:flows');
    });

    it('skips bracket links and other words ending in ref', () => {
        expect(findBareRefs('[[ref:x]] href:y xref:z')).toEqual([]);
    });
});

describe('findLabelLine', () => {
    it('finds #+name:, label:, \\label{}, CUSTOM_ID and <<target>>', () => {
        const lines = [
            '#+name: table-data',
            'label:fig-1',
            '\\begin{equation}\\label{eq-1}',
            ':CUSTOM_ID: intro',
            'see <<my-target>> here',
        ];
        expect(findLabelLine(lines, 'table-data')).toEqual({ line: 0, type: 'Named Element' });
        expect(findLabelLine(lines, 'fig-1')?.line).toBe(1);
        expect(findLabelLine(lines, 'eq-1')?.line).toBe(2);
        expect(findLabelLine(lines, 'intro')?.line).toBe(3);
        expect(findLabelLine(lines, 'my-target')).toEqual({ line: 4, type: 'Target' });
        expect(findLabelLine(lines, 'missing')).toBeNull();
    });

    it('does not take the ref link itself as the definition', () => {
        expect(findLabelLine(['see ref:table-data.', '#+NAME: table-data'], 'table-data')?.line).toBe(1);
    });
});

describe('OrgLinkProvider ref links', () => {
    it('makes a bare ref in a table clickable', () => {
        const links = refLinks('| a | ref:table-data. |\n');
        expect(links).toHaveLength(1);
        expect(links[0].args).toEqual({ file: '/docs/notes.org', label: 'table-data' });
    });

    it('routes [[ref:label]] to the label lookup', () => {
        const links = refLinks('see [[ref:table-data]] and [[eqref:eq-1][Eq. 1]]');
        expect(links.map(l => l.args.label)).toEqual(['table-data', 'eq-1']);
    });
});
