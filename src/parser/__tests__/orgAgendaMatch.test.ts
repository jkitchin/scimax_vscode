import { describe, it, expect } from 'vitest';
import {
    compileMatch,
    parseMatch,
    parseDuration,
    resolveDateExpr,
    matchPrefilter,
    type MatchableHeading,
} from '../orgAgendaMatch';

const NOW = new Date(2026, 9, 17, 12, 0); // Sat Oct 17 2026

function heading(over: Partial<MatchableHeading> = {}): MatchableHeading {
    return {
        title: 'A heading',
        isDone: false,
        level: 1,
        tags: [],
        inheritedTags: [],
        properties: {},
        ...over,
    };
}

function matches(src: string, h: MatchableHeading, inheritTags = true): boolean {
    const c = compileMatch(src, { now: NOW, inheritTags });
    if (!c.ok) throw new Error(`${c.error} at ${c.column}`);
    return c.predicate(h);
}

describe('agenda match strings: tags', () => {
    const work = heading({ tags: ['work', 'urgent'] });
    const home = heading({ tags: ['home'] });

    it('matches a bare tag and +tag', () => {
        expect(matches('work', work)).toBe(true);
        expect(matches('+work', work)).toBe(true);
        expect(matches('work', home)).toBe(false);
    });

    it('ANDs terms within a group', () => {
        expect(matches('+work+urgent', work)).toBe(true);
        expect(matches('work&urgent', work)).toBe(true);
        expect(matches('+work+boss', work)).toBe(false);
    });

    it('negates with -', () => {
        expect(matches('+work-urgent', work)).toBe(false);
        expect(matches('-boss', work)).toBe(true);
        expect(matches('-work', home)).toBe(true);
    });

    it('ORs groups with |', () => {
        expect(matches('work|home', home)).toBe(true);
        expect(matches('boss|home', work)).toBe(false);
    });

    it('matches tag regexes', () => {
        expect(matches('{^wo}', work)).toBe(true);
        expect(matches('-{^ur}', work)).toBe(false);
        expect(matches('{^x}', work)).toBe(false);
    });

    it('is case-sensitive for tags, as in Org', () => {
        expect(matches('Work', work)).toBe(false);
    });

    it('uses inherited tags unless inheritance is off', () => {
        const child = heading({ tags: [], inheritedTags: ['project'] });
        expect(matches('project', child)).toBe(true);
        expect(matches('project', child, false)).toBe(false);
    });

    it('matches everything for an empty string', () => {
        expect(matches('', home)).toBe(true);
    });
});

describe('agenda match strings: properties', () => {
    it('compares LEVEL numerically', () => {
        expect(matches('LEVEL=2', heading({ level: 2 }))).toBe(true);
        expect(matches('LEVEL>1', heading({ level: 1 }))).toBe(false);
        expect(matches('LEVEL<=3', heading({ level: 3 }))).toBe(true);
    });

    it('compares PRIORITY with the default priority for none', () => {
        expect(matches('PRIORITY="A"', heading({ priority: 'A' }))).toBe(true);
        expect(matches('PRIORITY="B"', heading())).toBe(true);
        expect(matches('PRIORITY<>"A"', heading({ priority: 'C' }))).toBe(true);
    });

    it('compares TODO, ITEM and CATEGORY', () => {
        expect(matches('TODO="NEXT"', heading({ todoState: 'NEXT' }))).toBe(true);
        expect(matches('ITEM={budget}', heading({ title: 'Write the budget' }))).toBe(true);
        expect(matches('CATEGORY="work"', heading({ category: 'work' }))).toBe(true);
    });

    it('reads drawer properties case-insensitively', () => {
        const h = heading({ properties: { Client: 'Acme Corp', Hours: '12' } });
        expect(matches('CLIENT="Acme Corp"', h)).toBe(true);
        expect(matches('client={^Acme}', h)).toBe(true);
        expect(matches('CLIENT<>{^Acme}', h)).toBe(false);
        expect(matches('HOURS>10', h)).toBe(true);
        expect(matches('HOURS>20', h)).toBe(false);
    });

    it('treats a missing numeric property as 0', () => {
        expect(matches('HOURS<1', heading())).toBe(true);
        expect(matches('HOURS>0', heading())).toBe(false);
    });

    it('compares durations in minutes', () => {
        const h = heading({ properties: { EFFORT: '1:30' } });
        expect(matches('EFFORT>1:00', h)).toBe(true);
        expect(matches('EFFORT<=1:30', h)).toBe(true);
        expect(matches('EFFORT<1h', h)).toBe(false);
        expect(matches('EFFORT<2h', h)).toBe(true);
    });

    it('compares dates by day', () => {
        const h = heading({ scheduled: new Date(2026, 9, 18, 9, 0) });
        expect(matches('SCHEDULED="<tomorrow>"', h)).toBe(true);
        expect(matches('SCHEDULED<"<+3d>"', h)).toBe(true);
        expect(matches('SCHEDULED<"<today>"', h)).toBe(false);
        expect(matches('SCHEDULED>=<2026-10-18>', h)).toBe(true);
        expect(matches('DEADLINE<"<+1w>"', h)).toBe(false); // no deadline
        expect(matches('DEADLINE<>"<today>"', h)).toBe(true);
    });

    it('negates property terms', () => {
        expect(matches('work-LEVEL>1', heading({ tags: ['work'], level: 1 }))).toBe(true);
        expect(matches('work-LEVEL>1', heading({ tags: ['work'], level: 2 }))).toBe(false);
    });

    it('accepts != and == as aliases', () => {
        expect(matches('LEVEL==1', heading())).toBe(true);
        expect(matches('LEVEL!=1', heading())).toBe(false);
    });
});

describe('agenda match strings: TODO part', () => {
    const todo = heading({ todoState: 'TODO', tags: ['work'] });
    const waiting = heading({ todoState: 'WAITING', tags: ['work'] });
    const done = heading({ todoState: 'DONE', isDone: true, tags: ['work'] });
    const plain = heading({ tags: ['work'] });

    it('requires a TODO keyword', () => {
        expect(matches('work/TODO', todo)).toBe(true);
        expect(matches('work/TODO', plain)).toBe(false);
        expect(matches('work/', plain)).toBe(false);
    });

    it('ORs and negates keywords', () => {
        expect(matches('work/TODO|WAITING', waiting)).toBe(true);
        expect(matches('work/-WAITING', waiting)).toBe(false);
        expect(matches('work/-WAITING', todo)).toBe(true);
    });

    it('/! drops done states', () => {
        expect(matches('work/!', done)).toBe(false);
        expect(matches('work/!', todo)).toBe(true);
        expect(matches('work/!-WAITING', waiting)).toBe(false);
    });

    it('matches keyword regexes', () => {
        expect(matches('/{^WAIT}', waiting)).toBe(true);
        expect(matches('/{^WAIT}', todo)).toBe(false);
    });

    it('works with the Org manual project example', () => {
        const project = heading({ level: 2, tags: ['project'], todoState: 'NEXT' });
        expect(matches('LEVEL=2+project/!-DONE', project)).toBe(true);
        expect(matches('LEVEL=2+project/!-DONE', { ...project, level: 3 })).toBe(false);
    });
});

describe('agenda match strings: errors', () => {
    const err = (src: string) => {
        const r = parseMatch(src);
        if (r.ok) throw new Error(`expected "${src}" to fail`);
        return r;
    };

    it('reports unclosed braces and strings with a column', () => {
        expect(err('work+{abc').column).toBe(6);
        expect(err('X="abc').error).toMatch(/Unclosed string/);
    });

    it('rejects invalid regexes', () => {
        expect(err('{[}').error).toMatch(/Invalid regular expression/);
    });

    it('rejects a regex with an ordering operator', () => {
        expect(err('X<{a}').error).toMatch(/= or <>/);
    });

    it('rejects stray characters and bad dates', () => {
        expect(err('work*').error).toMatch(/Unexpected/);
        expect(err('SCHEDULED<"<someday>"').error).toMatch(/Unrecognized date/);
    });

    it('rejects oversized input', () => {
        expect(err('a'.repeat(3000)).error).toMatch(/longer than/);
        expect(err(Array(300).fill('a').join('+')).error).toMatch(/Too many terms/);
    });
});

describe('agenda match prefilter', () => {
    const pre = (src: string) => {
        const r = parseMatch(src);
        if (!r.ok) throw new Error(r.error);
        return matchPrefilter(r.parsed);
    };

    it('collects required tags and level from a single group', () => {
        expect(pre('+work+urgent-boss+LEVEL=2')).toEqual({ requiredTags: ['work', 'urgent'], level: 2 });
    });

    it('does not constrain tags across OR groups', () => {
        expect(pre('work|home')).toEqual({});
    });

    it('pushes the TODO part', () => {
        expect(pre('work/!')).toEqual({ requiredTags: ['work'], requireTodo: true, excludeDone: true });
        expect(pre('/TODO|NEXT')).toEqual({ requireTodo: true, todoStates: ['TODO', 'NEXT'] });
        expect(pre('/-WAITING')).toEqual({ requireTodo: true });
    });
});

describe('durations and dates', () => {
    it('parses Org durations', () => {
        expect(parseDuration('1:30')).toBe(90);
        expect(parseDuration('2h')).toBe(120);
        expect(parseDuration('1h30min')).toBe(90);
        expect(parseDuration('1d')).toBe(1440);
        expect(parseDuration('abc')).toBeUndefined();
    });

    it('resolves date expressions', () => {
        expect(resolveDateExpr('today', NOW)).toEqual(new Date(2026, 9, 17));
        expect(resolveDateExpr('+3d', NOW)).toEqual(new Date(2026, 9, 20));
        expect(resolveDateExpr('-1w', NOW)).toEqual(new Date(2026, 9, 10));
        expect(resolveDateExpr('2026-12-01 Tue', NOW)).toEqual(new Date(2026, 11, 1));
        expect(resolveDateExpr('nope', NOW)).toBeUndefined();
    });
});
