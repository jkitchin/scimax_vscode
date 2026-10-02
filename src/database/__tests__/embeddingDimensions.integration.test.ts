/**
 * Embeddings must work when the provider is configured after initialize().
 *
 * Regression for issue #59: the chunks table was created with 384 dimensions
 * during initialize(), before the embedding service was set, so every insert
 * of a 768-dim nomic-embed-text vector failed silently and stats reported
 * "no embeddings yet" after every sync.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScimaxDbCore, CoreEmbeddingService } from '../scimaxDbCore';

// Creating and indexing a database can pass vitest's 10 s hook limit on a slow CI runner (Windows)
const SETUP_TIMEOUT_MS = 60_000;

function fakeService(dimensions: number): CoreEmbeddingService {
    const vec = () => Array.from({ length: dimensions }, (_, i) => (i % 7) / 7 + 0.01);
    return {
        dimensions,
        embed: async () => vec(),
        embedBatch: async (texts: string[]) => texts.map(() => vec()),
    };
}

describe('embedding dimensions (integration)', () => {
    let dir: string;
    let file: string;
    let db: ScimaxDbCore;

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-embed-'));
        file = path.join(dir, 'a.org');
        fs.writeFileSync(file, '* Heading\nSome text about catalysis.\n');
        db = new ScimaxDbCore({ dbPath: path.join(dir, 'test.db') });
        await db.initialize();
    }, SETUP_TIMEOUT_MS);

    afterEach(async () => {
        await db.close?.();
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // best-effort
        }
    });

    it('stores 768-dim embeddings when the service is set after initialize()', async () => {
        await db.setEmbeddingService(fakeService(768));
        await db.indexFile(file, { queueEmbeddings: true });
        await db.waitForEmbeddings();

        expect(db.getEmbeddingFailures().count).toBe(0);
        const stats = await db.getStats();
        expect(stats.chunks).toBeGreaterThan(0);
    });

    it('embeds files indexed before a provider was configured', async () => {
        await db.indexFile(file);
        expect((await db.getStats()).chunks).toBe(0);

        await db.setEmbeddingService(fakeService(768));
        expect(await db.queueMissingEmbeddings()).toBe(1);
        await db.waitForEmbeddings();

        expect((await db.getStats()).chunks).toBeGreaterThan(0);
    });

    it('rebuilds the chunks table when the model dimension changes', async () => {
        await db.setEmbeddingService(fakeService(384));
        await db.indexFile(file);
        expect((await db.getStats()).chunks).toBeGreaterThan(0);

        await db.setEmbeddingService(fakeService(1024));
        expect((await db.getStats()).chunks).toBe(0);
        await db.indexFile(file);
        expect(db.getEmbeddingFailures().count).toBe(0);
        expect((await db.getStats()).chunks).toBeGreaterThan(0);
    });

    it('rebuilds a vector index whose metadata disagrees with the table', async () => {
        await db.setEmbeddingService(fakeService(768));
        await db.close();

        // Rewrite the index metadata to 384 dims (key 4) while the table stays
        // 768: the state a real database was found in after a rebuild.
        const { createClient } = await import('@libsql/client');
        const raw = createClient({ url: `file:${path.join(dir, 'test.db')}` });
        const row = (await raw.execute(
            "SELECT metadata FROM libsql_vector_meta_shadow WHERE name = 'idx_chunks_embedding'"
        )).rows[0] as any;
        const blob = new Uint8Array(row.metadata as ArrayBuffer).slice();
        const view = new DataView(blob.buffer);
        for (let i = 0; i + 9 <= blob.length; i += 9) {
            if (blob[i] === 4) view.setBigUint64(i + 1, 384n, true);
        }
        await raw.execute({
            sql: "UPDATE libsql_vector_meta_shadow SET metadata = ? WHERE name = 'idx_chunks_embedding'",
            args: [blob],
        });
        raw.close();

        db = new ScimaxDbCore({ dbPath: path.join(dir, 'test.db') });
        await db.initialize();
        await db.setEmbeddingService(fakeService(768));
        await db.indexFile(file, { queueEmbeddings: true });
        await db.waitForEmbeddings();

        expect(db.getEmbeddingFailures().count).toBe(0);
        expect((await db.getStats()).chunks).toBeGreaterThan(0);
    });

    it('skips stale chunks when the file is re-indexed while embedding', async () => {
        // Re-indexing gives the file a new id. Before the fix, chunks computed
        // for the old id were inserted afterwards and failed the foreign key.
        let release!: () => void;
        const gate = new Promise<void>(r => { release = r; });
        const service = fakeService(768);
        let calls = 0;
        await db.setEmbeddingService({
            ...service,
            embedBatch: async (texts: string[]) => {
                if (calls++ === 0) await gate;
                return service.embedBatch(texts);
            },
        });

        await db.indexFile(file, { queueEmbeddings: true });
        await new Promise(r => setTimeout(r, 50)); // the queue is now waiting in embedBatch
        fs.writeFileSync(file, '* Heading\nEdited text about catalysis.\n');
        await db.indexFile(file, { queueEmbeddings: true });
        release();
        await db.waitForEmbeddings();

        expect(db.getEmbeddingFailures()).toEqual({ count: 0, lastError: null });
        const rows = await (db as any).db.execute('SELECT content FROM chunks');
        expect(rows.rows.map((r: any) => r.content)).toEqual(['* Heading\nEdited text about catalysis.']);
    }, SETUP_TIMEOUT_MS);

    it('reports progress as done/total, one call per file', async () => {
        const second = path.join(dir, 'b.org');
        fs.writeFileSync(second, '* Other\nMore text.\n');
        const calls: Array<[number, number]> = [];
        (db as any).onEmbeddingProgress = (done: number, total: number) => calls.push([done, total]);
        await db.indexFile(file);
        await db.indexFile(second);
        await db.setEmbeddingService(fakeService(768));
        db.queueEmbeddings(file);
        db.queueEmbeddings(second);
        await db.waitForEmbeddings();
        // The first file starts before the second is queued, so the total grows
        expect(calls).toEqual([[0, 1], [1, 2]]);
    }, SETUP_TIMEOUT_MS);
});
