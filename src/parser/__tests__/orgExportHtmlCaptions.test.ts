import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
    Disposable: class {
        constructor(private callback: () => void) {}
        dispose() { this.callback(); }
    },
}));

import { parseOrgFast } from '../orgExportParser';
import { exportToHtml } from '../orgExportHtml';

const html = (org: string) => exportToHtml(parseOrgFast(org), { toc: false, standalone: false } as any);

describe('HTML export captions', () => {
    it('wraps a captioned, named image in a figure', () => {
        const out = html('#+CAPTION: A *bold* plot\n#+NAME: fig-plot\n[[file:plot.png]]\n');
        expect(out).toMatch(/<figure id="fig-plot">\s*<img src="plot.png"/);
        expect(out).toContain('<figcaption>A <strong>bold</strong> plot</figcaption>');
    });

    it('renders markup in table and src block captions', () => {
        const out = html('#+CAPTION: Data in =x.csv=\n| a | b |\n|---+---|\n| 1 | 2 |\n\n#+CAPTION: The /code/\n#+BEGIN_SRC python\nx = 1\n#+END_SRC\n');
        expect(out).toContain('<caption>Data in <code class="verbatim">x.csv</code></caption>');
        expect(out).toContain('The <em>code</em>');
        expect(out).not.toContain('=x.csv=');
    });

    it('leaves a plain image paragraph alone', () => {
        expect(html('[[file:plot.png]]\n')).not.toContain('<figure');
    });
});
