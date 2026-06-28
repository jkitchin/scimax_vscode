/**
 * Tests for dialog notes: helpers and export exclusion.
 */
import { describe, it, expect } from 'vitest';
import {
    isNoteLabel,
    makeNoteLabel,
    findNoteReferences,
    findNoteDefinitions,
    parseNoteMeta,
    buildNoteDefinition,
    stripNoteFootnotes,
} from '../orgNotes';
import { parseOrgFast } from '../orgExportParser';
import { exportToHtml } from '../orgExportHtml';

describe('orgNotes helpers', () => {
    it('identifies note labels by prefix', () => {
        expect(isNoteLabel('note-why-db')).toBe(true);
        expect(isNoteLabel('1')).toBe(false);
        expect(isNoteLabel(undefined)).toBe(false);
    });

    it('builds a legal note label from a slug', () => {
        expect(makeNoteLabel('Why SQLite?')).toBe('note-why-sqlite');
        expect(makeNoteLabel('note-already')).toBe('note-already');
    });

    it('finds note references with positions', () => {
        const refs = findNoteReferences('See here[fn:note-why-db] and [fn:1] not.');
        expect(refs).toHaveLength(1);
        expect(refs[0].label).toBe('note-why-db');
        expect(refs[0].line).toBe(0);
    });

    it('parses the note metadata line', () => {
        const m = parseNoteMeta('Decision · alice · 2026-06-28 · open');
        expect(m.type).toBe('decision');
        expect(m.author).toBe('alice');
        expect(m.date).toBe('2026-06-28');
        expect(m.state).toBe('open');
    });

    it('finds note definitions with parsed type', () => {
        const text = '[fn:note-x] Question · bob · 2026-06-28\n  Should we cache?';
        const defs = findNoteDefinitions(text);
        expect(defs).toHaveLength(1);
        expect(defs[0].type).toBe('question');
        expect(defs[0].author).toBe('bob');
    });

    it('builds a definition with metadata and indented body', () => {
        const def = buildNoteDefinition('note-x', 'decision', 'Chose embedded.', 'alice', '2026-06-28');
        expect(def).toContain('[fn:note-x] Decision · alice · 2026-06-28 · open');
        expect(def).toContain('\n  Chose embedded.');
    });
});

describe('stripNoteFootnotes / export exclusion', () => {
    const content = [
        '* Storage',
        'We use an embedded database[fn:note-why-db] for portability[fn:1].',
        '',
        '* Footnotes',
        '[fn:1] A real footnote that should still export.',
        '',
        '* Notes :noexport:',
        '[fn:note-why-db] Decision · alice · 2026-06-28 · open',
        '  Chose embedded over client/server.',
    ].join('\n');

    it('removes note references and definitions from the AST but keeps real footnotes', () => {
        const doc = parseOrgFast(content);
        stripNoteFootnotes(doc);
        const json = JSON.stringify(doc);
        expect(json).not.toContain('note-why-db');
        expect(json).toContain('"label":"1"');
    });

    it('excludes notes from HTML export but keeps real footnotes', () => {
        const doc = parseOrgFast(content);
        const html = exportToHtml(doc, { standalone: false } as any);
        expect(html).not.toContain('note-why-db');
        expect(html).not.toContain('Chose embedded over client/server');
        // The genuine footnote survives.
        expect(html).toContain('A real footnote that should still export');
    });

    it('keeps notes when excludeNoteFootnotes is false', () => {
        const doc = parseOrgFast(content);
        const html = exportToHtml(doc, { standalone: false, excludeNoteFootnotes: false } as any);
        expect(html).toContain('Chose embedded over client/server');
    });
});
