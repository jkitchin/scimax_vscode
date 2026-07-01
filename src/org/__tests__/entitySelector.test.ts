/**
 * Tests for the entity selector: pure URL/link helpers and the DB-backed
 * queryEntities (tag / property / intersection).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// entitySelector imports vscode (and, transitively, dependencyCommands/todoStates).
// Mock it so the module loads; the functions under test don't touch the vscode API.
vi.mock('vscode', () => ({
    window: {}, workspace: { getConfiguration: () => ({ get: () => [] }) },
    commands: {}, languages: {}, env: {}, Uri: { file: (p: string) => ({ fsPath: p }) },
    Range: class {}, Position: class {}, Selection: class {},
}));

import { mapsUrl, mailtoUrl, idLink, queryEntities } from '../entitySelector';
import { ScimaxDbCore } from '../../database/scimaxDbCore';

describe('entity selector helpers', () => {
    it('builds a Google Maps search URL with an encoded query', () => {
        expect(mapsUrl('123 Main St, Anytown')).toBe(
            'https://www.google.com/maps/search/?api=1&query=123%20Main%20St%2C%20Anytown'
        );
    });
    it('builds a mailto URL', () => {
        expect(mailtoUrl(' ana@example.edu ')).toBe('mailto:ana@example.edu');
    });
    it('builds an id link with the title as description', () => {
        expect(idLink('person-ana', 'Ana Ramirez')).toBe('[[id:person-ana][Ana Ramirez]]');
    });
});

describe('queryEntities (integration)', () => {
    let dir: string;
    let db: ScimaxDbCore;

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-entity-'));
        const file = path.join(dir, 'entities.org');
        fs.writeFileSync(file, [
            '* Ana Ramirez                          :person:',
            ':PROPERTIES:',
            ':ID: person-ana',
            ':EMAIL: ana@example.edu',
            ':END:',
            '* Lab B                                :location:',
            ':PROPERTIES:',
            ':ID: loc-b',
            ':ADDRESS: 123 Science Dr',
            ':END:',
            '* Reagent X                            :reagent:location:',
            ':PROPERTIES:',
            ':ID: rx',
            ':ADDRESS: Shelf 3',
            ':END:',
        ].join('\n'));
        db = new ScimaxDbCore({ dbPath: path.join(dir, 'test.db') });
        await db.initialize();
        await db.indexFile(file);
    });

    afterAll(async () => {
        await db.close?.();
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    });

    it('selects headings by tag', async () => {
        const people = await queryEntities(db, { name: 'Contacts', tag: 'person' });
        expect(people.map(h => h.title.replace(/\s+:.*$/, '').trim())).toEqual(['Ana Ramirez']);
    });

    it('selects headings by property presence', async () => {
        const withAddress = await queryEntities(db, { name: 'Addr', property: 'ADDRESS' });
        expect(withAddress.length).toBe(2); // Lab B and Reagent X
    });

    it('intersects tag AND property', async () => {
        const locWithAddr = await queryEntities(db, { name: 'Locations', tag: 'location', property: 'ADDRESS' });
        const titles = locWithAddr.map(h => h.title.replace(/\s+:.*$/, '').trim()).sort();
        expect(titles).toEqual(['Lab B', 'Reagent X']);
    });

    it('selects a custom entity type by an arbitrary tag (reagent)', async () => {
        const reagents = await queryEntities(db, { name: 'Reagents', tag: 'reagent' });
        expect(reagents.map(h => h.title.replace(/\s+:.*$/, '').trim())).toEqual(['Reagent X']);
    });
});
