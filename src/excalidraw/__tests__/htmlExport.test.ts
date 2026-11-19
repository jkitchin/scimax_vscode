import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseOrgFast } from '../../parser/orgExportParser';
import { exportToHtml, fileLinkHref } from '../../parser/orgExportHtml';
import { normalizeScene, renderSceneSvg, orgLinkUri } from '../scene';
import { excalidrawHtml, rewriteDrawingHref } from '../htmlExport';

let dir: string;

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-excalidraw-'));
    fs.mkdirSync(path.join(dir, 'diagrams'));
    const scene = normalizeScene([
        { id: 'a', type: 'rectangle', x: 0, y: 0, label: 'Results', orgLink: 'file:../notes.org::*Results and discussion' },
        { id: 'b', type: 'rectangle', x: 200, y: 0, label: 'Paper', link: 'https://doi.org/10.1/x' },
        { id: 'c', type: 'rectangle', x: 400, y: 0, label: 'Cite', orgLink: 'cite:&smith2020' },
        { id: 'd', type: 'rectangle', x: 600, y: 0, label: 'Same file', link: orgLinkUri('#setup', path.join(dir, 'notes.org')) },
    ]);
    fs.writeFileSync(path.join(dir, 'diagrams', 'flow.excalidraw'), JSON.stringify(scene));
    fs.writeFileSync(path.join(dir, 'diagrams', 'flow.excalidraw.svg'), renderSceneSvg(scene, { embedScene: true })!);
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const options = () => ({ baseDir: dir, fileHref: (l: string) => fileLinkHref(l) });

describe('rewriteDrawingHref', () => {
    it('maps org links to exported HTML relative to the export folder', () => {
        const drawingDir = path.join(dir, 'diagrams');
        expect(rewriteDrawingHref(orgLinkUri('file:../notes.org::*Results and discussion'), drawingDir, options()))
            .toBe('notes.html#org-results-and-discussion');
        expect(rewriteDrawingHref(orgLinkUri('id:abc-123'), drawingDir, options())).toBe('#abc-123');
        expect(rewriteDrawingHref(orgLinkUri('doi:10.1/x'), drawingDir, options())).toBe('https://doi.org/10.1/x');
        expect(rewriteDrawingHref(orgLinkUri('cite:&smith2020'), drawingDir, options())).toBeNull();
        expect(rewriteDrawingHref(orgLinkUri('*Methods', path.join(dir, 'sub', 'other.org')), drawingDir, options()))
            .toBe('sub/other.html#org-methods');
        expect(rewriteDrawingHref('command:scimax.foo', drawingDir, options())).toBeNull();
        expect(rewriteDrawingHref('data.csv', drawingDir, options())).toBe('diagrams/data.csv');
    });
});

describe('excalidrawHtml', () => {
    it('returns null for a missing file', () => {
        expect(excalidrawHtml('nope.excalidraw', options())).toBeNull();
    });
});

describe('HTML export of drawing links', () => {
    for (const file of ['diagrams/flow.excalidraw', 'diagrams/flow.excalidraw.svg']) {
        it(`inlines ${file} with web links`, () => {
            const html = exportToHtml(parseOrgFast(`#+CAPTION: The flow\n[[file:${file}]]\n`), { baseDir: dir, bodyOnly: true });
            expect(html).toContain('<figure');
            expect(html).toContain('<span class="org-excalidraw"><svg style="max-width: 100%; height: auto"');
            expect(html).toContain('href="notes.html#org-results-and-discussion"');
            expect(html).toContain('href="https://doi.org/10.1/x"');
            expect(html).toContain('href="notes.html#setup"');
            expect(html).not.toContain('vscode://');
            expect(html).not.toContain('payload-start');
        });
    }

    it('keeps the old export without baseDir or with a description', () => {
        expect(exportToHtml(parseOrgFast('[[file:diagrams/flow.excalidraw.svg]]\n'), { bodyOnly: true }))
            .toContain('<img src="diagrams/flow.excalidraw.svg"');
        expect(exportToHtml(parseOrgFast('[[file:diagrams/flow.excalidraw][the flow]]\n'), { baseDir: dir, bodyOnly: true }))
            .toContain('<a href="diagrams/flow.excalidraw">the flow</a>');
    });
});
