/**
 * Excalidraw drawings in the index: a heading a drawing's shape links to
 * lists the drawing among its back-links, and the shapes' text is searchable.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('vscode', () => ({ Disposable: class { dispose() { /* none */ } } }));
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScimaxDbCore } from '../scimaxDbCore';
import { encodeScenePayload, orgLinkUri, type ExcalidrawScene } from '../../excalidraw/scene';
import { LinkGraphQueryService } from '../../linkGraph/linkGraphQueries';

const SETUP_TIMEOUT_MS = 60_000;

describe('drawing back-links (integration)', () => {
    let dir: string;
    let db: ScimaxDbCore;
    let notes: string;
    let drawing: string;

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-drawbl-'));
        notes = path.join(dir, 'notes.org');
        fs.writeFileSync(notes, [
            '* Model fitting',
            ':PROPERTIES:',
            ':ID: 11111111-aaaa',
            ':END:',
            '* Raw data',
            ':PROPERTIES:',
            ':CUSTOM_ID: raw',
            ':END:',
            '* Discussion',
        ].join('\n'));

        fs.mkdirSync(path.join(dir, 'diagrams'));
        drawing = path.join(dir, 'diagrams', 'pipeline.excalidraw.svg');
        const box = (id: string, link: string, label: string) => [
            { id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, link, boundElements: [{ id: id + 't', type: 'text' }] },
            { id: id + 't', type: 'text', x: 0, y: 0, width: 10, height: 10, text: label, containerId: id },
        ];
        const scene: ExcalidrawScene = {
            type: 'excalidraw', version: 2, elements: [
                ...box('a', orgLinkUri('id:11111111-aaaa'), 'Fit the zebrafish model'),
                ...box('b', orgLinkUri('file:../notes.org::#raw'), 'Raw data'),
                ...box('c', orgLinkUri('file:../notes.org::*Discussion'), 'Talk'),
            ],
        };
        fs.writeFileSync(drawing, `<svg xmlns="http://www.w3.org/2000/svg"><!-- svg-source:excalidraw --><!-- payload-type:application/vnd.excalidraw+json --><!-- payload-version:2 --><!-- payload-start -->${encodeScenePayload(scene)}<!-- payload-end --></svg>`);

        db = new ScimaxDbCore({ dbPath: path.join(dir, 'test.db') });
        await db.initialize();
        await db.indexFile(notes);
        await db.indexFile(drawing);
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await db?.close();
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // Windows can hold the SQLite file briefly after close; best-effort.
        }
    });

    it('lists the drawing as a back-link of headings by ID, CUSTOM_ID and title', async () => {
        const [byId, byCustom, byTitle] = await db.getBacklinksBatch([
            { kind: 'heading', title: 'Model fitting', id: '11111111-aaaa', filePath: notes },
            { kind: 'heading', title: 'Raw data', customId: 'raw', filePath: notes },
            { kind: 'heading', title: 'Discussion', filePath: notes },
        ]);
        expect(byId.map(r => r.file_path)).toEqual([drawing]);
        expect(byId[0].description).toBe('Fit the zebrafish model');
        expect(byCustom.map(r => r.file_path)).toEqual([drawing]);
        expect(byTitle.map(r => r.file_path)).toEqual([drawing]);
    });

    it('indexes the drawing by its shapes, not its SVG', async () => {
        const file = (await db.getFiles()).find(f => f.path === drawing);
        expect(file?.file_type).toBe('excalidraw');
        const hits = await db.searchFullText('zebrafish');
        expect(hits.map(h => h.file_path)).toContain(drawing);
    });

    it('puts the drawing in the link graph of the notes it links to, by file and by id', async () => {
        const graph = new LinkGraphQueryService(db.getClient()!);
        const incoming = await graph.buildGraph(notes, 1, 'both', {}, 50);
        expect(incoming.nodes.map(n => n.id)).toContain(drawing);
        const edges = incoming.edges.filter(e => e.from === drawing && e.to === notes);
        expect(edges.map(e => e.linkType).sort()).toEqual(['file', 'id']);

        const outgoing = await graph.buildGraph(drawing, 1, 'outgoing', {}, 50);
        expect(outgoing.nodes.map(n => n.id)).toContain(notes);
    });
});
