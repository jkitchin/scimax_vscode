import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { drawingLinkRow, indexDrawing } from '../indexing';
import { encodeScenePayload, orgLinkUri, type ExcalidrawScene } from '../scene';

const DRAWING = '/proj/diagrams/map.excalidraw.svg';

describe('drawingLinkRow', () => {
    it('maps org links to the link types back-links match on', () => {
        expect(drawingLinkRow(orgLinkUri('id:abc-123'), DRAWING, 'Fit')).toEqual({ type: 'id', target: 'abc-123', description: 'Fit', lineNumber: 1 });
        expect(drawingLinkRow(orgLinkUri('file:../notes.org::*Results'), DRAWING)).toMatchObject({ type: 'file', target: 'file:../notes.org::*Results' });
        expect(drawingLinkRow(orgLinkUri('nb:other::a.org'), DRAWING)).toMatchObject({ type: 'nb' });
        expect(drawingLinkRow('https://example.com', DRAWING)).toMatchObject({ type: 'https' });
        expect(drawingLinkRow('notes.org', DRAWING)).toMatchObject({ type: 'file', target: 'notes.org' });
    });

    it('turns *heading / #id links copied from an org file into file links to it', () => {
        expect(drawingLinkRow(orgLinkUri('*Results', '/proj/notes.org'), DRAWING))
            .toMatchObject({ type: 'file', target: `file:${path.resolve('/proj/notes.org')}::*Results` });
        expect(drawingLinkRow(orgLinkUri('*Results'), DRAWING)).toBeNull();
    });
});

describe('indexDrawing', () => {
    const scene: ExcalidrawScene = {
        type: 'excalidraw', version: 2, elements: [
            { id: 'box', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, link: orgLinkUri('id:abc'), boundElements: [{ id: 't', type: 'text' }] },
            { id: 't', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'Model\nfitting', containerId: 'box' },
            { id: 'gone', type: 'text', x: 0, y: 0, width: 1, height: 1, text: 'deleted', isDeleted: true },
        ],
    };

    it('indexes shape text and links from JSON and SVG drawings', () => {
        const json = indexDrawing(JSON.stringify(scene), '/p/a.excalidraw')!;
        expect(json.text).toBe('Model\nfitting');
        expect(json.links).toEqual([{ type: 'id', target: 'abc', description: 'Model fitting', lineNumber: 1 }]);

        const svg = `<svg><!-- svg-source:excalidraw --><!-- payload-type:application/vnd.excalidraw+json --><!-- payload-version:2 --><!-- payload-start -->${encodeScenePayload(scene)}<!-- payload-end --></svg>`;
        expect(indexDrawing(svg, '/p/a.excalidraw.svg')?.links).toHaveLength(1);
    });

    it('returns null for files without a scene', () => {
        expect(indexDrawing('<svg></svg>', '/p/a.excalidraw.svg')).toBeNull();
        expect(indexDrawing('not json', '/p/a.excalidraw')).toBeNull();
    });
});
