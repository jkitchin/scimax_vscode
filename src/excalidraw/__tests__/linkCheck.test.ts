import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { normalizeScene, orgLinkUri } from '../scene';
import { checkSceneLinks, orgLinkProblem } from '../linkCheck';

let dir: string;

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-linkcheck-'));
    fs.writeFileSync(path.join(dir, 'notes.org'),
        '* TODO [#A] Model fitting :analysis:\n* Data\n:PROPERTIES:\n:CUSTOM_ID: data\n:END:\n');
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('orgLinkProblem', () => {
    it('accepts existing files, headings and custom ids', () => {
        expect(orgLinkProblem('file:notes.org', dir)).toBeNull();
        expect(orgLinkProblem('file:notes.org::*Model fitting', dir)).toBeNull();
        expect(orgLinkProblem('notes.org::#data', dir)).toBeNull();
        expect(orgLinkProblem('[[file:notes.org::12]]', dir)).toBeNull();
        expect(orgLinkProblem('*Data', dir, path.join(dir, 'notes.org'))).toBeNull();
    });

    it('reports missing files, headings and custom ids', () => {
        expect(orgLinkProblem('file:nope.org', dir)).toMatch(/file not found/);
        expect(orgLinkProblem('file:notes.org::*Nope', dir)).toMatch(/no heading "Nope"/);
        expect(orgLinkProblem('file:notes.org::#nope', dir)).toMatch(/no CUSTOM_ID "nope"/);
        expect(orgLinkProblem('*Data', dir)).toMatch(/needs a from= file/);
    });

    it('skips links it cannot check', () => {
        expect(orgLinkProblem('id:123', dir)).toBeNull();
        expect(orgLinkProblem('cite:&smith', dir)).toBeNull();
        expect(orgLinkProblem('https://x.org/a.html', dir)).toBeNull();
    });
});

describe('checkSceneLinks', () => {
    it('resolves links relative to the drawing or the from file', () => {
        const scene = normalizeScene([
            { id: 'ok', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, orgLink: 'file:../notes.org::*Data' },
            { id: 'bad', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, orgLink: 'file:notes.org::*Data' },
            { id: 'from', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, link: orgLinkUri('#data', path.join(dir, 'notes.org')) },
            { id: 'rel', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, link: 'missing.csv' },
        ]);
        const problems = checkSceneLinks(scene, path.join(dir, 'diagrams', 'flow.excalidraw.svg'));
        expect(problems.map(p => p.id)).toEqual(['bad', 'rel']);
    });
});
