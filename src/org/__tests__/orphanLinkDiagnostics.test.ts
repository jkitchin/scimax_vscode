/**
 * Tests for orphan link detection (granular addressing diagnostics).
 */
import { describe, it, expect } from 'vitest';

// vscode is imported by the module but only used by the provider, not by the
// pure computeOrphanLinks function under test. Mock it so the import resolves.
import { vi } from 'vitest';
vi.mock('vscode', () => ({
    languages: { createDiagnosticCollection: vi.fn() },
    workspace: {},
    window: {},
    Range: class {},
    Diagnostic: class {},
    DiagnosticSeverity: { Warning: 1 }
}));

import { computeOrphanLinks } from '../orphanLinkDiagnostics';

const never = async () => false;   // no cross-file anchor exists
const always = async () => true;   // a cross-file anchor exists

describe('computeOrphanLinks', () => {
    it('does not flag a link to an existing in-document anchor', async () => {
        const text = 'A passage <<why-sqlite>> here.\nSee [[why-sqlite]].';
        expect(await computeOrphanLinks(text, never)).toEqual([]);
    });

    it('flags a link whose anchor was deleted and text is absent', async () => {
        const text = 'See [[why-sqlite]] for the rationale.';
        const orphans = await computeOrphanLinks(text, never);
        expect(orphans).toHaveLength(1);
        expect(orphans[0].target).toBe('why-sqlite');
    });

    it('does not flag when a cross-file anchor resolves in the database', async () => {
        const text = 'See [[why-sqlite]] for the rationale.';
        expect(await computeOrphanLinks(text, always)).toEqual([]);
    });

    it('does not flag a fuzzy link whose text appears as prose', async () => {
        const text = 'The mouse is great.\nSee [[mouse]].';
        expect(await computeOrphanLinks(text, never)).toEqual([]);
    });

    it('resolves links to #+NAME anchors', async () => {
        const text = '#+NAME: results-table\n| a | b |\nSee [[results-table]].';
        expect(await computeOrphanLinks(text, never)).toEqual([]);
    });

    it('resolves links to radio targets', async () => {
        const text = 'A <<<dynamic knowledge repository>>> lives.\nSee [[dynamic knowledge repository]].';
        expect(await computeOrphanLinks(text, never)).toEqual([]);
    });

    it('flags [[*Heading]] with no matching heading', async () => {
        const text = '* Introduction\nSee [[*Conclusion]].';
        const orphans = await computeOrphanLinks(text, never);
        expect(orphans).toHaveLength(1);
        expect(orphans[0].target).toBe('*Conclusion');
    });

    it('does not flag [[*Heading]] that exists', async () => {
        const text = '* Introduction\n* Conclusion\nSee [[*Conclusion]].';
        expect(await computeOrphanLinks(text, never)).toEqual([]);
    });

    it('resolves [[Title]] / [[*Title]] to a heading with a custom TODO keyword', async () => {
        const text = '#+TODO: ⚠️ 👀 | ✅\n* ⚠️ Overview\nSee [[Overview]] and [[*Overview]].';
        expect(await computeOrphanLinks(text, never)).toEqual([]);
    });

    it('ignores external, file, custom-id, id, and cross-file links', async () => {
        const text = [
            'See [[https://example.com]].',
            'See [[file:foo.png]].',
            'See [[./notes.org]].',
            'See [[#some-custom-id]].',
            'See [[id:abc-123]].',
            'See [[other.org::frag]].'
        ].join('\n');
        expect(await computeOrphanLinks(text, never)).toEqual([]);
    });

    it('does not flag links inside source blocks', async () => {
        const text = '#+BEGIN_SRC python\nx = "[[not-a-link]]"\n#+END_SRC';
        expect(await computeOrphanLinks(text, never)).toEqual([]);
    });

    it('reports the correct offset/length for the target', async () => {
        const text = 'See [[gone]].';
        const orphans = await computeOrphanLinks(text, never);
        expect(text.substr(orphans[0].targetStartOffset, orphans[0].targetLength)).toBe('gone');
    });

    it('handles [[target][description]] form', async () => {
        const text = 'See [[gone][the rationale]].';
        const orphans = await computeOrphanLinks(text, never);
        expect(orphans).toHaveLength(1);
        expect(orphans[0].target).toBe('gone');
    });
});
