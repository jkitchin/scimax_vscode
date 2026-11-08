import { describe, it, expect } from 'vitest';
import type { HeadingRecord } from '../../database/scimaxDbCore';
import {
    emptyFilters, hasFilters, parsePropertyFilters, parsePathPatterns, queryTerms, termRegex,
    matchingLines, marksIn, parseSnippet, FileOutline, headingTags, headingPasses, pathPasses,
    ResultBuilder, MAX_HITS_PER_FILE, chunkLines, filesInOrder,
    headingDone, todoMatches, TODO_OPEN, TODO_DONE, DEFAULT_DONE_STATES,
} from '../searchModel';

function heading(line: number, level: number, title: string, extra: Partial<HeadingRecord> = {}): HeadingRecord {
    return {
        id: line, file_id: 1, file_path: '/n.org', level, title, line_number: line, begin_pos: 0,
        todo_state: null, priority: null, tags: '[]', inherited_tags: '[]', properties: '{}',
        scheduled: null, deadline: null, closed: null, cell_index: null,
        ...extra,
    } as unknown as HeadingRecord;
}

describe('filters', () => {
    it('parses property filters', () => {
        expect(parsePropertyFilters('STATUS=draft, AUTHOR; :TYPE: paper')).toEqual([
            { key: 'STATUS', value: 'draft' },
            { key: 'AUTHOR' },
            { key: 'TYPE', value: 'paper' },
        ]);
        expect(parsePropertyFilters('  ')).toEqual([]);
    });

    it('parses path patterns', () => {
        expect(parsePathPatterns('notes, *.md\nprojects/x ')).toEqual(['notes', '*.md', 'projects/x']);
    });

    it('knows when there are filters', () => {
        expect(hasFilters(emptyFilters())).toBe(false);
        expect(hasFilters({ ...emptyFilters(), paths: ['x'] })).toBe(true);
    });
});

describe('queryTerms', () => {
    it('drops operators, NOT terms and column names', () => {
        expect(queryTerms('cats AND dogs NOT birds OR title:fish NEAR 5')).toEqual([
            { text: 'cats', prefix: false },
            { text: 'dogs', prefix: false },
            { text: 'fish', prefix: false },
        ]);
    });

    it('keeps phrases and prefixes', () => {
        expect(queryTerms('"heat transfer" cataly*')).toEqual([
            { text: 'heat transfer', prefix: false },
            { text: 'cataly', prefix: true },
        ]);
    });

    it('drops duplicates regardless of case', () => {
        expect(queryTerms('Foo foo')).toHaveLength(1);
    });
});

describe('termRegex and matchingLines', () => {
    it('returns null with no terms', () => {
        expect(termRegex([])).toBeNull();
    });

    it('matches word starts and stem variants', () => {
        const re = termRegex(queryTerms('designs'))!;
        const lines = ['Design notes', 'we designed it', 'redesign', 'nothing here', 'designing'];
        const found = matchingLines(lines, re);
        expect(found.map(m => m.line)).toEqual([1, 2, 5]);
        expect(found[0].marks).toEqual([[0, 6]]);
    });

    it('undoubles a final consonant after a suffix', () => {
        const re = termRegex(queryTerms('running'))!;
        expect(matchingLines(['run fast', 'runner', 'rerun'], re).map(m => m.line)).toEqual([1, 2]);
    });

    it('matches whole words only for short terms', () => {
        const re = termRegex(queryTerms('cat'))!;
        expect(matchingLines(['cat', 'cats', 'concat'], re).map(m => m.line)).toEqual([1]);
    });

    it('matches phrases across punctuation', () => {
        const re = termRegex(queryTerms('"heat transfer"'))!;
        expect(marksIn('Heat-transfer rates', re)).toEqual([[0, 13]]);
    });

    it('counts distinct terms per line', () => {
        const re = termRegex(queryTerms('alpha beta'))!;
        expect(matchingLines(['alpha beta alpha'], re)[0].distinct).toBe(2);
    });

    it('gives no marks without a regex', () => {
        expect(marksIn('anything', null)).toEqual([]);
    });
});

describe('parseSnippet', () => {
    it('strips mark tags and records ranges', () => {
        expect(parseSnippet('a <mark>b</mark> c\n d <mark>ee</mark>')).toEqual({
            text: 'a b c d ee',
            marks: [[2, 3], [8, 10]],
        });
    });

    it('handles an unclosed mark', () => {
        expect(parseSnippet('x <mark>yz')).toEqual({ text: 'x yz', marks: [[2, 4]] });
    });
});

describe('FileOutline', () => {
    const hs = [heading(10, 2, 'B'), heading(1, 1, 'A'), heading(20, 3, 'C'), heading(30, 1, 'D')];
    const outline = new FileOutline(hs);

    it('finds the heading a line is in', () => {
        expect(outline.headingAt(0)).toBeUndefined();
        expect(outline.headingAt(1)?.title).toBe('A');
        expect(outline.headingAt(15)?.title).toBe('B');
        expect(outline.headingAt(25)?.title).toBe('C');
        expect(outline.headingAt(99)?.title).toBe('D');
    });

    it('builds the title chain', () => {
        expect(outline.outline(outline.headingAt(25))).toEqual(['A', 'B', 'C']);
        expect(outline.outline(outline.headingAt(30))).toEqual(['D']);
        expect(outline.outline(undefined)).toEqual([]);
    });
});

describe('heading filters', () => {
    const h = heading(1, 1, 'T', {
        tags: '["Work"]', inherited_tags: '["project"]', properties: '{"Status":"Draft v2","AUTHOR":"me"}',
    } as Partial<HeadingRecord>);

    it('merges own and inherited tags, lowercased', () => {
        expect(headingTags(h).sort()).toEqual(['project', 'work']);
    });

    it('applies tag filters', () => {
        expect(headingPasses(h, { ...emptyFilters(), includeTags: ['WORK'] })).toBe(true);
        expect(headingPasses(h, { ...emptyFilters(), includeTags: ['work', 'home'] })).toBe(false);
        expect(headingPasses(h, { ...emptyFilters(), excludeTags: ['project'] })).toBe(false);
    });

    it('applies property filters case-insensitively', () => {
        expect(headingPasses(h, { ...emptyFilters(), properties: [{ key: 'STATUS', value: 'draft' }] })).toBe(true);
        expect(headingPasses(h, { ...emptyFilters(), properties: [{ key: 'author' }] })).toBe(true);
        expect(headingPasses(h, { ...emptyFilters(), properties: [{ key: 'STATUS', value: 'final' }] })).toBe(false);
        expect(headingPasses(h, { ...emptyFilters(), properties: [{ key: 'MISSING' }] })).toBe(false);
    });

    it('lets lines above every heading pass only exclude filters', () => {
        expect(headingPasses(undefined, emptyFilters())).toBe(true);
        expect(headingPasses(undefined, { ...emptyFilters(), excludeTags: ['x'] })).toBe(true);
        expect(headingPasses(undefined, { ...emptyFilters(), includeTags: ['x'] })).toBe(false);
        expect(headingPasses(undefined, { ...emptyFilters(), properties: [{ key: 'X' }] })).toBe(false);
    });

    it('tolerates bad JSON', () => {
        expect(headingTags(heading(1, 1, 'x', { tags: 'nope' } as Partial<HeadingRecord>))).toEqual([]);
    });
});

describe('TODO filters', () => {
    const todo = heading(1, 1, 'a', { todo_state: 'TODO', todo_type: 'todo' } as Partial<HeadingRecord>);
    const wait = heading(2, 1, 'b', { todo_state: 'WAIT', todo_type: 'todo' } as Partial<HeadingRecord>);
    const done = heading(3, 1, 'c', { todo_state: 'DONE' } as Partial<HeadingRecord>);
    const shipped = heading(4, 1, 'd', { todo_state: 'SHIPPED', todo_type: 'done' } as Partial<HeadingRecord>);
    const plain = heading(5, 1, 'e');
    const ds = DEFAULT_DONE_STATES;

    it('knows done states from the file and the setting', () => {
        expect([todo, wait, done, shipped, plain].map(h => headingDone(h, ds))).toEqual([false, false, true, true, false]);
        expect(headingDone(wait, ['WAIT'])).toBe(true);
    });

    it('matches states and the any-open and any-done pseudo-states', () => {
        const all = [todo, wait, done, shipped, plain];
        expect(all.filter(h => todoMatches(h, TODO_OPEN, ds)).map(h => h.title)).toEqual(['a', 'b']);
        expect(all.filter(h => todoMatches(h, TODO_DONE, ds)).map(h => h.title)).toEqual(['c', 'd']);
        expect(all.filter(h => todoMatches(h, 'WAIT', ds)).map(h => h.title)).toEqual(['b']);
    });

    it('ORs included states and drops excluded ones', () => {
        const f = { ...emptyFilters(), includeTodo: ['TODO', 'DONE'], doneStates: ds };
        expect([todo, wait, done, plain].map(h => headingPasses(h, f))).toEqual([true, false, true, false]);
        const g = { ...emptyFilters(), includeTodo: [TODO_OPEN], excludeTodo: ['WAIT'], doneStates: ds };
        expect([todo, wait, done].map(h => headingPasses(h, g))).toEqual([true, false, false]);
        expect(headingPasses(plain, { ...emptyFilters(), excludeTodo: [TODO_DONE], doneStates: ds })).toBe(true);
    });

    it('fails lines above every heading when a state is required', () => {
        expect(headingPasses(undefined, { ...emptyFilters(), includeTodo: ['TODO'] })).toBe(false);
        expect(headingPasses(undefined, { ...emptyFilters(), excludeTodo: ['TODO'] })).toBe(true);
        expect(hasFilters({ ...emptyFilters(), excludeTodo: ['TODO'] })).toBe(true);
    });
});

describe('pathPasses', () => {
    const file = '/Users/me/notes/research/catalysis.org';

    it('passes everything with no patterns', () => {
        expect(pathPasses(file, [])).toBe(true);
    });

    it('matches plain text anywhere, ignoring case', () => {
        expect(pathPasses(file, ['Research'])).toBe(true);
        expect(pathPasses(file, ['journal'])).toBe(false);
    });

    it('matches slash-less globs against the file name', () => {
        expect(pathPasses(file, ['*.org'])).toBe(true);
        expect(pathPasses(file, ['*.md'])).toBe(false);
    });

    it('matches globs against the relative path', () => {
        expect(pathPasses(file, ['research/*.org'], 'research/catalysis.org')).toBe(true);
        expect(pathPasses(file, ['**/research/**'])).toBe(true);
    });

    it('passes when any pattern matches', () => {
        expect(pathPasses(file, ['journal', 'catalysis'])).toBe(true);
    });
});

describe('ResultBuilder', () => {
    const hit = (line: number, kinds: Array<'fulltext' | 'semantic' | 'headings'> = ['fulltext']) =>
        ({ line, text: `line ${line}`, marks: [], outline: [], kinds });

    it('fuses ranks across modes', () => {
        const b = new ResultBuilder();
        b.rankFile('/a', 'fulltext', 0);
        b.rankFile('/b', 'fulltext', 1);
        b.rankFile('/b', 'headings', 0);
        b.addHit('/a', hit(1));
        b.addHit('/b', hit(1));
        const r = b.results();
        expect(r.map(f => f.filePath)).toEqual(['/b', '/a']);
        expect(r[0].kinds).toEqual(['fulltext', 'headings']);
        expect(r[0].score).toBeCloseTo(1.5);
    });

    it('merges hits on the same line', () => {
        const b = new ResultBuilder();
        b.rankFile('/a', 'fulltext', 0);
        b.addHit('/a', hit(3));
        b.addHit('/a', { ...hit(3, ['headings']), marks: [[0, 1]], todo: 'TODO', tags: ['x'] });
        const [f] = b.results();
        expect(f.hits).toHaveLength(1);
        expect(f.hits[0]).toMatchObject({ kinds: ['fulltext', 'headings'], marks: [[0, 1]], todo: 'TODO', tags: ['x'] });
    });

    it('sorts hits by line, caps them and drops empty files', () => {
        const b = new ResultBuilder();
        b.rankFile('/a', 'fulltext', 0);
        b.rankFile('/empty', 'fulltext', 1);
        for (let i = MAX_HITS_PER_FILE + 5; i > 0; i--) b.addHit('/a', hit(i));
        const r = b.results();
        expect(r.map(f => f.filePath)).toEqual(['/a']);
        expect(r[0].hits).toHaveLength(MAX_HITS_PER_FILE);
        expect(r[0].hits[0].line).toBe(1);
    });

    it('does not list a removed and re-ranked file twice', () => {
        const b = new ResultBuilder();
        b.rankFile('/a', 'fulltext', 0);
        b.remove('/a');
        expect(b.has('/a')).toBe(false);
        b.rankFile('/a', 'semantic', 0);
        b.addHit('/a', hit(1, ['semantic']));
        expect(b.results().map(f => f.filePath)).toEqual(['/a']);
    });

    describe('sort orders', () => {
        const build = () => {
            const b = new ResultBuilder();
            ['/x/b10.org', '/y/a.org', '/x/b9.org'].forEach((p, i) => {
                b.rankFile(p, 'fulltext', i);
                b.addHit(p, hit(1));
            });
            return b;
        };
        const mtimes = new Map([['/x/b10.org', 100], ['/y/a.org', 300]]);

        it('sorts by score by default', () => {
            expect(build().results().map(f => f.filePath)).toEqual(['/x/b10.org', '/y/a.org', '/x/b9.org']);
        });

        it('sorts newest first, files without a time last', () => {
            const r = build().results('recent', mtimes);
            expect(r.map(f => f.filePath)).toEqual(['/y/a.org', '/x/b10.org', '/x/b9.org']);
            expect(r[0].mtime).toBe(300);
        });

        it('sorts by file name, numbers in order', () => {
            expect(build().results('name').map(f => f.filePath)).toEqual(['/y/a.org', '/x/b9.org', '/x/b10.org']);
        });
    });

    it('ignores hits for unranked files', () => {
        const b = new ResultBuilder();
        b.addHit('/nope', hit(1));
        expect(b.results()).toEqual([]);
    });
});

describe('helpers', () => {
    it('takes non-blank chunk lines', () => {
        expect(chunkLines('\n a  \n\n b\n c\n', 2)).toEqual([' a', ' b']);
    });

    it('lists files once, in order', () => {
        expect(filesInOrder([{ file_path: '/b' }, { file_path: '/a' }, { file_path: '/b' }])).toEqual(['/b', '/a']);
    });
});
