/**
 * The chunks table must not carry a libsql vector index.
 *
 * Earlier versions created one that semantic search never used. Every write
 * updated it, and on a real database it grew to 47 GB for 296k chunks, which
 * made the full-scan semantic search take over a minute. initialize() now
 * drops it, and semantic search works without it.
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

describe('vector index removal (integration)', () => {
    let dir: string;
    let dbPath: string;
    let files: string[];
    let db: ScimaxDbCore;

    const hasVectorIndex = async (): Promise<boolean> => {
        const r = await (db as any).db.execute(
            "SELECT name FROM sqlite_master WHERE name = 'idx_chunks_embedding'"
        );
        return r.rows.length > 0;
    };

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-vecidx-'));
        dbPath = path.join(dir, 'test.db');
        files = [1, 2, 3].map(i => {
            const file = path.join(dir, `f${i}.org`);
            fs.writeFileSync(file, `* Heading ${i}\nSome text about catalysis number ${i}.\n`);
            return file;
        });
        db = new ScimaxDbCore({ dbPath });
        await db.initialize();
        await db.setEmbeddingService(fakeService(8));
        for (const file of files) await db.indexFile(file);
    }, SETUP_TIMEOUT_MS);

    afterEach(async () => {
        await db.close?.();
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // best-effort
        }
    });

    it('indexes and searches embeddings without a vector index', async () => {
        expect(await hasVectorIndex()).toBe(false);
        expect(db.getEmbeddingFailures().count).toBe(0);
        expect((await db.getStats()).vector_search_supported).toBe(true);

        const results = await db.searchSemantic('catalysis');
        expect(results.length).toBe(3);
    });

    it('drops a vector index left by an earlier version', async () => {
        await (db as any).db.execute(
            "CREATE INDEX idx_chunks_embedding ON chunks(libsql_vector_idx(embedding, 'metric=cosine'))"
        );
        expect(await hasVectorIndex()).toBe(true);
        await db.close();

        db = new ScimaxDbCore({ dbPath });
        await db.initialize();
        await db.setEmbeddingService(fakeService(8));
        expect(await hasVectorIndex()).toBe(false);
        expect((await db.searchSemantic('catalysis')).length).toBe(3);
    });

    it('clear() empties the chunks, and embedding works again after', async () => {
        await db.clear();
        expect((await db.getStats()).chunks).toBe(0);

        await db.indexFile(files[0]);
        expect(db.getEmbeddingFailures().count).toBe(0);
        expect((await db.getStats()).has_embeddings).toBe(true);
    });

    it('optimize() removes indexed files that no longer exist', async () => {
        fs.rmSync(files[1]);
        const result = await db.optimize();
        expect(result.removedFiles).toBe(1);
        expect(describeOptimize(result)).toContain('removed 1 missing file(s)');
    });
});
