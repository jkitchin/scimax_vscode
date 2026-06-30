/**
 * End-to-end test for the TODO dependency edge index: index real files with
 * :DEPENDS: properties and verify getHeadingById / getDependencies /
 * getDependents resolve across files, and that reindexing updates edges.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScimaxDbCore, parseDependsIds, getPropCaseInsensitive } from '../scimaxDbCore';

describe('parseDependsIds', () => {
    it('splits on whitespace and commas and strips the id: prefix', () => {
        expect(parseDependsIds('id:a id:b')).toEqual(['a', 'b']);
        expect(parseDependsIds('a, b ,c')).toEqual(['a', 'b', 'c']);
        expect(parseDependsIds('ID:UpperCase')).toEqual(['UpperCase']);
        expect(parseDependsIds('')).toEqual([]);
        expect(parseDependsIds('   ')).toEqual([]);
    });
});

describe('getPropCaseInsensitive', () => {
    it('reads a property regardless of key case', () => {
        const props = { ID: 'x', depends: 'id:y' };
        expect(getPropCaseInsensitive(props, 'ID')).toBe('x');
        expect(getPropCaseInsensitive(props, 'id')).toBe('x');
        expect(getPropCaseInsensitive(props, 'DEPENDS')).toBe('id:y');
        expect(getPropCaseInsensitive(props, 'missing')).toBeUndefined();
    });
});

describe('task dependencies (integration)', () => {
    let dir: string;
    let db: ScimaxDbCore;
    let aPath: string;
    let bPath: string;

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-dep-'));
        aPath = path.join(dir, 'a.org');
        bPath = path.join(dir, 'b.org');

        fs.writeFileSync(bPath, [
            '* TODO Run analysis',
            ':PROPERTIES:',
            ':ID: analysis-9b2',
            ':END:',
            '* TODO Make figures',
            ':PROPERTIES:',
            ':ID: figures-4c1',
            ':END:',
        ].join('\n'));

        fs.writeFileSync(aPath, [
            '* TODO Write paper',
            ':PROPERTIES:',
            ':ID: paper-7f3a',
            ':DEPENDS: id:analysis-9b2 id:figures-4c1',
            ':END:',
        ].join('\n'));

        db = new ScimaxDbCore({ dbPath: path.join(dir, 'test.db') });
        await db.initialize();
        await db.indexFile(bPath);
        await db.indexFile(aPath);
    });

    afterAll(async () => {
        await db.close?.();
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // best-effort
        }
    });

    it('resolves a heading by :ID: across files', async () => {
        const paper = await db.getHeadingById('paper-7f3a');
        expect(paper?.title).toBe('Write paper');
        expect(paper?.file_path).toBe(aPath);
    });

    it('lists a heading\'s forward dependencies', async () => {
        const deps = await db.getDependencies('paper-7f3a');
        expect(deps.map(d => d.to_id).sort()).toEqual(['analysis-9b2', 'figures-4c1']);
    });

    it('lists reverse dependents for any depended-on id (not just the first)', async () => {
        // figures-4c1 is the SECOND id in :DEPENDS:, which the value-anchored
        // searchByProperty could not find — the edge table must.
        const depFigures = await db.getDependents('figures-4c1');
        expect(depFigures.map(d => d.from_id)).toEqual(['paper-7f3a']);
        const depAnalysis = await db.getDependents('analysis-9b2');
        expect(depAnalysis.map(d => d.from_id)).toEqual(['paper-7f3a']);
    });

    it('updates edges when a file is reindexed', async () => {
        fs.writeFileSync(aPath, [
            '* TODO Write paper',
            ':PROPERTIES:',
            ':ID: paper-7f3a',
            ':DEPENDS: id:analysis-9b2',
            ':END:',
        ].join('\n'));
        await db.indexFile(aPath);

        const deps = await db.getDependencies('paper-7f3a');
        expect(deps.map(d => d.to_id)).toEqual(['analysis-9b2']);
        // figures-4c1 no longer has a dependent.
        const depFigures = await db.getDependents('figures-4c1');
        expect(depFigures).toEqual([]);
        const all = await db.getAllDependencies();
        expect(all.length).toBe(1);
    });
});
