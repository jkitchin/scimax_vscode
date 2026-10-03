/**
 * The vector index must not keep nodes for deleted chunks.
 *
 * A database from earlier versions had a 55 GB vector index for zero chunks.
 * optimize() rebuilds an index like that, and clear() recreates it empty.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScimaxDbCore, CoreEmbeddingService, describeOptimize } from '../scimaxDbCore';

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

describe('vector index cleanup (integration)', () => {
    let dir: string;
    let files: string[];
    let db: ScimaxDbCore;

    const indexNodes = async (): Promise<number> => {
        const r = await (db as any).db.execute('SELECT COUNT(*) as count FROM idx_chunks_embedding_shadow');
        return Number(r.rows[0].count);
    };

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-vecidx-'));
        files = [1, 2, 3].map(i => {
            const file = path.join(dir, `f${i}.org`);
            fs.writeFileSync(file, `* Heading ${i}\nSome text about catalysis number ${i}.\n`);
            return file;
        });
        db = new ScimaxDbCore({ dbPath: path.join(dir, 'test.db') });
        await db.initialize();
        await db.setEmbeddingService(fakeService(8));
        for (const file of files) await db.indexFile(file);
        expect(await indexNodes()).toBeGreaterThan(0);
    }, SETUP_TIMEOUT_MS);

    afterEach(async () => {
        await db.close?.();
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // best-effort
        }
    });

    it('clear() leaves no index nodes behind, and embedding works again after', async () => {
        await db.clear();
        expect(await indexNodes()).toBe(0);

        await db.indexFile(files[0]);
        expect(db.getEmbeddingFailures().count).toBe(0);
        expect((await db.getStats()).has_embeddings).toBe(true);
    });

    it('optimize() rebuilds an index with far more nodes than chunks', async () => {
        // Leave stale nodes behind: without foreign keys a bare DELETE
        // truncates the table without visiting the index.
        await (db as any).db.execute('PRAGMA foreign_keys = OFF');
        await (db as any).db.execute('DELETE FROM chunks');
        await (db as any).db.execute('PRAGMA foreign_keys = ON');
        expect(await indexNodes()).toBeGreaterThan(0);

        (db as any).staleIndexSlack = 0;
        const result = await db.optimize();
        expect(result.vectorIndexRebuilt).toBe(true);
        expect(await indexNodes()).toBe(0);
        expect(describeOptimize(result)).toContain('rebuilt the vector index');

        // A healthy index is left alone.
        await db.indexFile(files[0]);
        expect((await db.optimize()).vectorIndexRebuilt).toBe(false);
    });

    it('optimize() removes indexed files that no longer exist', async () => {
        fs.rmSync(files[1]);
        const result = await db.optimize();
        expect(result.removedFiles).toBe(1);
        expect(describeOptimize(result)).toContain('removed 1 missing file(s)');
    });
});
