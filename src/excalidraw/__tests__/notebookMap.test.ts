import { describe, it, expect } from 'vitest';
import { notebookMapSpec } from '../notebookMap';
import { checkScene, normalizeScene, parseOrgLinkUri, renderSceneSvg, decodeScenePayload } from '../scene';

const files = [
    { path: '/nb/notes/methods.org', content: '* Sample prep\n:PROPERTIES:\n:ID: prep-1\n:END:\n* Analysis\nSee [[file:../README.org::*Goals][goals]].\n' },
    { path: '/nb/README.org', content: '* Goals\nRead [[file:notes/methods.org]] and [[id:prep-1]].\n* DONE Kickoff\n** Sub heading not shown\n' },
    { path: '/nb/notes/empty.org', content: 'no headings here\n' },
];

describe('notebookMapSpec', () => {
    const spec = notebookMapSpec(files, { title: 'My notebook', drawingDir: '/nb/diagrams', masterFile: '/nb/README.org' });
    const scene = normalizeScene(spec);
    const byId = new Map(scene.elements.map(e => [e.id, e]));
    const linkOf = (id: string) => parseOrgLinkUri(String(byId.get(id)?.link ?? ''))?.link;

    it('puts the master file first and links headers to files, boxes to headings', () => {
        expect(linkOf('file-0')).toBe('file:../README.org');
        expect(linkOf('h-0-0')).toBe('file:../README.org::*Goals');
        expect(linkOf('h-0-1')).toBe('file:../README.org::*Kickoff');
        expect(linkOf('h-2-0')).toBe('id:prep-1'); // methods.org sorts after empty.org
        expect(byId.has('h-0-2')).toBe(false); // only top-level headings
    });

    it('draws arrows for file, heading and id links between sections', () => {
        const arrows = scene.elements.filter(e => e.type === 'arrow')
            .map(e => `${e.startBinding?.elementId}>${e.endBinding?.elementId}`).sort();
        // Goals -> methods file, Goals -> Sample prep (id), methods Analysis -> README Goals
        expect(arrows).toEqual(['h-0-0>file-2', 'h-0-0>h-2-0', 'h-2-1>h-0-0'].sort());
    });

    it('is a valid scene that renders and round-trips through SVG', () => {
        expect(checkScene(scene)).toEqual([]);
        const svg = renderSceneSvg(scene, { embedScene: true })!;
        expect(decodeScenePayload(svg)?.elements.length).toBe(scene.elements.length);
    });

    it('caps files and headings', () => {
        const many = Array.from({ length: 5 }, (_, i) => ({ path: `/nb/f${i}.org`, content: '* a\n* b\n* c\n' }));
        const capped = normalizeScene(notebookMapSpec(many, { title: 't', drawingDir: '/nb', maxFiles: 2, maxHeadings: 1 }));
        const texts = capped.elements.filter(e => e.type === 'text').map(e => e.text);
        expect(texts).toContain('3 more files not shown');
        expect(texts).toContain('2 more headings');
    });
});
