import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { headingSnippet, linkForHeading, linkStatus, NoteIndex, parseOrgHeadings, type ResolveContext } from '../noteIndex';
import { orgLinkUri } from '../scene';

const NOTES = `#+TODO: TODO DOING | DONE KILLED
* Analysis
** DOING [#A] Model fitting                                    :model:
SCHEDULED: <2026-11-20 Fri>
:PROPERTIES:
:ID:       abc-123
:END:
Fit the Arrhenius model.
More text.
** DONE Raw data
:PROPERTIES:
:CUSTOM_ID: raw
:END:
Collected on Monday.
** KILLED Old idea
#+begin_src org
* Not a heading
#+end_src
`;

describe('parseOrgHeadings', () => {
    const hs = parseOrgHeadings(NOTES, '/n/notes.org');

    it('reads keywords from #+TODO, priority, tags, ids and outline', () => {
        const fit = hs.find(h => h.title === 'Model fitting')!;
        expect(fit).toMatchObject({ line: 3, level: 2, todo: 'DOING', done: false, priority: 'A', tags: ['model'], id: 'abc-123', outline: ['Analysis'] });
        expect(hs.find(h => h.title === 'Raw data')).toMatchObject({ todo: 'DONE', done: true, customId: 'raw' });
        expect(hs.find(h => h.title === 'Old idea')).toMatchObject({ todo: 'KILLED', done: true });
    });

    it('ignores headings inside blocks', () => {
        expect(hs.map(h => h.title)).not.toContain('Not a heading');
    });

    it('snippet skips drawers', () => {
        expect(headingSnippet(NOTES, 3)).toBe('SCHEDULED: <2026-11-20 Fri>\nFit the Arrhenius model.\nMore text.');
    });
});

describe('linkStatus', () => {
    let dir: string;
    let ctx: ResolveContext;
    let drawing: string;

    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-noteidx-'));
        fs.writeFileSync(path.join(dir, '.projectile'), '');
        fs.writeFileSync(path.join(dir, 'notes.org'), NOTES);
        fs.mkdirSync(path.join(dir, 'diagrams'));
        drawing = path.join(dir, 'diagrams', 'map.excalidraw.svg');
        ctx = { index: new NoteIndex(), roots: [dir], notebookRoot: name => (name === 'proj' ? dir : undefined) };
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('resolves id: links through the project', async () => {
        const s = await linkStatus(orgLinkUri('id:abc-123'), drawing, ctx);
        expect(s).toMatchObject({ title: 'Model fitting', todo: 'DOING', priority: 'A', outline: 'Analysis', line: 3 });
        expect(s?.snippet).toContain('Arrhenius');
    });

    it('resolves file links with #custom-id and *heading relative to the drawing', async () => {
        expect(await linkStatus(orgLinkUri('file:../notes.org::#raw'), drawing, ctx)).toMatchObject({ title: 'Raw data', done: true });
        expect(await linkStatus(orgLinkUri('file:../notes.org::*Old idea'), drawing, ctx)).toMatchObject({ todo: 'KILLED' });
    });

    it('resolves nb: links through the notebook lookup', async () => {
        expect(await linkStatus(orgLinkUri('nb:proj::notes.org::#raw'), drawing, ctx)).toMatchObject({ title: 'Raw data' });
    });

    it('reports broken links', async () => {
        expect((await linkStatus(orgLinkUri('id:nope'), drawing, ctx))?.broken).toMatch(/no heading with ID/);
        expect((await linkStatus(orgLinkUri('file:../notes.org::*Missing'), drawing, ctx))?.broken).toMatch(/no heading "Missing"/);
        expect((await linkStatus(orgLinkUri('file:../gone.org'), drawing, ctx))?.broken).toMatch(/file not found/);
    });

    it('has no status for web links', async () => {
        expect(await linkStatus('https://example.com', drawing, ctx)).toBeUndefined();
        expect(await linkStatus(orgLinkUri('doi:10.1/x'), drawing, ctx)).toBeUndefined();
    });

    it('picks up unsaved text through overrides', async () => {
        ctx.index.overrides.set(path.join(dir, 'notes.org'), NOTES.replace('DOING [#A] Model', 'DONE [#A] Model'));
        expect(await linkStatus(orgLinkUri('id:abc-123'), drawing, ctx)).toMatchObject({ todo: 'DONE', done: true });
        ctx.index.overrides.clear();
    });
});

describe('linkForHeading', () => {
    it('prefers id, then custom id, then title, relative to the drawing', () => {
        const base = { file: '/p/notes.org', title: 'Results' };
        expect(linkForHeading({ ...base, id: 'u1' }, '/p/diagrams')).toBe('id:u1');
        expect(linkForHeading({ ...base, customId: 'res' }, '/p/diagrams')).toBe('file:../notes.org::#res');
        expect(linkForHeading(base, '/p')).toBe('file:notes.org::*Results');
    });
});
