import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
    Disposable: class {
        constructor(private callback: () => void) {}
        dispose() { this.callback(); }
    },
}));

import { parseObjects } from '../orgObjects';
import { parseOrgFast } from '../orgExportParser';
import { exportToLatex } from '../orgExportLatex';
import { serializeObject } from '../orgSerialize';

describe('=verbatim= and ~code~ (org syntax)', () => {
    it('parses = as verbatim and ~ as code', () => {
        expect(parseObjects('=a=')[0].type).toBe('verbatim');
        expect(parseObjects('~a~')[0].type).toBe('code');
    });

    it('round-trips through the serializer', () => {
        expect(serializeObject(parseObjects('=a=')[0])).toBe('=a=');
        expect(serializeObject(parseObjects('~a~')[0])).toBe('~a~');
    });

    it('exports =x= in the title like it does in the body (\\texttt, not \\verb)', () => {
        const latex = exportToLatex(parseOrgFast('#+TITLE: Using =x_y=\n\nBody =x_y=\n'), {});
        const title = /\\title\{([^\n]*)\}/.exec(latex)?.[1] ?? '';
        expect(title).toContain('\\texttt{');
        expect(title).not.toContain('\\verb');
    });
});
