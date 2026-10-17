/**
 * Org agenda match strings: the tags/property/TODO query language used by
 * `tags`, `tags-todo` and custom agenda commands.
 *
 *   +work-boss|home              tag logic: AND within a group, OR between groups
 *   {^proj}                      tag regex
 *   LEVEL=2+PRIORITY="A"         special and drawer properties
 *   EFFORT<=1:30                 durations compare in minutes
 *   SCHEDULED<"<+3d>"            dates compare by day
 *   CLIENT={^Acme}               property regex
 *   work/!-WAITING               after `/`: TODO keyword match; `!` = not done
 *
 * See https://orgmode.org/manual/Matching-tags-and-properties.html.
 *
 * Kept free of vscode imports so the CLI and unit tests can use it.
 */

// Per-function imports: the package index loads all of date-fns.
import addDays from 'date-fns/addDays';
import addWeeks from 'date-fns/addWeeks';
import addMonths from 'date-fns/addMonths';
import addYears from 'date-fns/addYears';
import startOfDay from 'date-fns/startOfDay';

// =============================================================================
// Types
// =============================================================================

/** The fields of a heading that a match string can test. */
export interface MatchableHeading {
    title: string;
    todoState?: string;
    /** The TODO keyword is a done state */
    isDone: boolean;
    priority?: string;
    level: number;
    /** The heading's own tags */
    tags: string[];
    /** Tags inherited from ancestors and #+FILETAGS */
    inheritedTags: string[];
    category?: string;
    /** Property drawer; names are matched case-insensitively */
    properties: Record<string, string>;
    scheduled?: Date;
    deadline?: Date;
    closed?: Date;
}

export interface MatchOptions {
    /** Tags inherited from ancestors count (org-use-tag-inheritance); default true */
    inheritTags?: boolean;
    /** PRIORITY of a heading without a cookie (org-priority-default); default 'B' */
    defaultPriority?: string;
    /** "Today" for date comparisons; default now */
    now?: Date;
}

export type MatchOp = '=' | '<>' | '<' | '<=' | '>' | '>=';

export type MatchValue =
    | { kind: 'number'; value: number }
    | { kind: 'duration'; minutes: number }
    | { kind: 'string'; value: string }
    | { kind: 'date'; expr: string }
    | { kind: 'regex'; source: string; regex: RegExp };

export type MatchAtom =
    | { kind: 'tag'; name: string }
    | { kind: 'tagRegex'; source: string; regex: RegExp }
    | { kind: 'property'; name: string; op: MatchOp; value: MatchValue };

export interface MatchTerm {
    negate: boolean;
    atom: MatchAtom;
}

/** TODO-keyword terms: a keyword name or a keyword regex. */
export type TodoAtom =
    | { kind: 'state'; name: string }
    | { kind: 'stateRegex'; source: string; regex: RegExp };

export interface TodoTerm {
    negate: boolean;
    atom: TodoAtom;
}

export interface ParsedMatch {
    /** OR of AND-groups. Empty means "match everything". */
    groups: MatchTerm[][];
    /** The part after `/`, if any */
    todo?: {
        /** `/!`: only headings in a not-done TODO state */
        onlyNotDone: boolean;
        /** OR of AND-groups. Empty means any TODO state */
        groups: TodoTerm[][];
    };
}

/**
 * Conditions cheap enough to push into SQL. A heading that fails them cannot
 * match; one that passes still has to pass the predicate.
 */
export interface MatchPrefilter {
    /** Every one of these tags must be present (own or, with inheritance, inherited) */
    requiredTags?: string[];
    /** The TODO keyword must be one of these */
    todoStates?: string[];
    /** Must have a TODO keyword */
    requireTodo?: boolean;
    /** Must not be in a done state */
    excludeDone?: boolean;
    /** Exact outline level */
    level?: number;
}

export type CompiledMatch =
    | {
        ok: true;
        parsed: ParsedMatch;
        predicate: (h: MatchableHeading) => boolean;
        prefilter: MatchPrefilter;
    }
    | { ok: false; error: string; column: number };

// =============================================================================
// Limits (see "Parser Safety Limits" in CLAUDE.md)
// =============================================================================

const MAX_MATCH_LENGTH = 2000;
const MAX_TERMS = 200;
const MAX_REGEX_LENGTH = 200;

/** Org tag and property-name characters. `-`, `+`, `|` and `&` are operators here. */
const NAME_CHAR = /[\w@#%]/;

// =============================================================================
// Parsing
// =============================================================================

class MatchSyntaxError extends Error {
    constructor(message: string, public column: number) {
        super(message);
    }
}

class Parser {
    pos = 0;
    terms = 0;

    constructor(private src: string) {}

    get done(): boolean {
        return this.pos >= this.src.length;
    }

    peek(offset = 0): string {
        return this.src[this.pos + offset] ?? '';
    }

    fail(message: string, column = this.pos): never {
        throw new MatchSyntaxError(message, column);
    }

    skipSpace(): void {
        while (!this.done && /\s/.test(this.peek())) this.pos++;
    }

    countTerm(): void {
        if (++this.terms > MAX_TERMS) this.fail(`Too many terms (limit ${MAX_TERMS})`);
    }

    readWhile(re: RegExp): string {
        const start = this.pos;
        while (!this.done && re.test(this.peek())) this.pos++;
        return this.src.slice(start, this.pos);
    }

    /** `{...}` with `\}` as an escaped brace. */
    readBraced(): { source: string; regex: RegExp } {
        const start = this.pos;
        this.pos++; // {
        let source = '';
        while (!this.done && this.peek() !== '}') {
            if (this.peek() === '\\' && this.peek(1) === '}') {
                source += '}';
                this.pos += 2;
                continue;
            }
            source += this.peek();
            this.pos++;
        }
        if (this.done) this.fail('Unclosed "{" in regular expression', start);
        this.pos++; // }
        return { source, regex: compileRegex(source, start) };
    }

    readQuoted(): string {
        const start = this.pos;
        this.pos++; // "
        let out = '';
        while (!this.done && this.peek() !== '"') {
            if (this.peek() === '\\' && this.pos + 1 < this.src.length) {
                out += this.peek(1);
                this.pos += 2;
                continue;
            }
            out += this.peek();
            this.pos++;
        }
        if (this.done) this.fail('Unclosed string', start);
        this.pos++; // "
        return out;
    }

    readOp(): MatchOp {
        const two = this.src.slice(this.pos, this.pos + 2);
        const map: Record<string, MatchOp> = { '<=': '<=', '>=': '>=', '<>': '<>', '!=': '<>', '==': '=' };
        if (map[two]) {
            this.pos += 2;
            return map[two];
        }
        const one = this.peek();
        if (one === '=' || one === '<' || one === '>') {
            this.pos++;
            return one;
        }
        return this.fail(`Expected a comparison operator, found "${one}"`);
    }

    readValue(op: MatchOp): MatchValue {
        const start = this.pos;
        const c = this.peek();
        if (c === '{') {
            if (op !== '=' && op !== '<>') this.fail('A regular expression can only be compared with = or <>', start);
            const { source, regex } = this.readBraced();
            return { kind: 'regex', source, regex };
        }
        if (c === '"') {
            const s = this.readQuoted();
            const date = /^<([^<>]+)>$/.exec(s);
            if (date) return checkedDate(date[1], start);
            return { kind: 'string', value: s };
        }
        if (c === '<') {
            const end = this.src.indexOf('>', this.pos);
            if (end < 0) this.fail('Unclosed "<" in date', start);
            const expr = this.src.slice(this.pos + 1, end);
            this.pos = end + 1;
            return checkedDate(expr, start);
        }
        // Bare value: a number, a duration, or a word. `-` only as a sign,
        // since it otherwise starts the next (negated) term.
        let raw = '';
        if (c === '-' || c === '+') {
            raw = c;
            this.pos++;
        }
        raw += this.readWhile(/[\w.:@#%]/);
        if (raw === '' || raw === '-' || raw === '+') this.fail('Expected a value', start);
        if (/^[-+]?\d+(\.\d+)?$/.test(raw)) return { kind: 'number', value: parseFloat(raw) };
        const minutes = parseDuration(raw);
        if (minutes !== undefined) return { kind: 'duration', minutes };
        return { kind: 'string', value: raw };
    }

    /** One AND-group of the tag/property part, up to `|`, `/` or the end. */
    parseGroup(): MatchTerm[] {
        const terms: MatchTerm[] = [];
        for (;;) {
            this.skipSpace();
            if (this.done || this.peek() === '|' || this.peek() === '/') break;
            if (this.peek() === '&') {
                this.pos++;
                continue;
            }
            let negate = false;
            if (this.peek() === '+' || this.peek() === '-') {
                negate = this.peek() === '-';
                this.pos++;
            }
            const start = this.pos;
            if (this.peek() === '{') {
                const { source, regex } = this.readBraced();
                terms.push({ negate, atom: { kind: 'tagRegex', source, regex } });
                this.countTerm();
                continue;
            }
            const name = this.readWhile(NAME_CHAR);
            if (!name) this.fail(`Unexpected "${this.peek()}"`);
            if (/[=<>!]/.test(this.peek())) {
                const op = this.readOp();
                const value = this.readValue(op);
                if (value.kind === 'regex' && op !== '=' && op !== '<>') {
                    this.fail('A regular expression can only be compared with = or <>', start);
                }
                terms.push({ negate, atom: { kind: 'property', name: name.toUpperCase(), op, value } });
            } else {
                terms.push({ negate, atom: { kind: 'tag', name } });
            }
            this.countTerm();
        }
        return terms;
    }

    /** One AND-group of the TODO part. */
    parseTodoGroup(): TodoTerm[] {
        const terms: TodoTerm[] = [];
        for (;;) {
            this.skipSpace();
            if (this.done || this.peek() === '|') break;
            if (this.peek() === '&') {
                this.pos++;
                continue;
            }
            let negate = false;
            if (this.peek() === '+' || this.peek() === '-') {
                negate = this.peek() === '-';
                this.pos++;
            }
            if (this.peek() === '{') {
                const { source, regex } = this.readBraced();
                terms.push({ negate, atom: { kind: 'stateRegex', source, regex } });
            } else {
                const name = this.readWhile(/[\w@#%]/);
                if (!name) this.fail(`Unexpected "${this.peek()}" in TODO match`);
                terms.push({ negate, atom: { kind: 'state', name } });
            }
            this.countTerm();
        }
        return terms;
    }

    parse(): ParsedMatch {
        const groups: MatchTerm[][] = [];
        for (;;) {
            const group = this.parseGroup();
            if (group.length) groups.push(group);
            if (this.peek() === '|') {
                this.pos++;
                continue;
            }
            break;
        }

        const result: ParsedMatch = { groups };
        if (this.peek() === '/') {
            this.pos++;
            this.skipSpace();
            let onlyNotDone = false;
            if (this.peek() === '!') {
                onlyNotDone = true;
                this.pos++;
            }
            const todoGroups: TodoTerm[][] = [];
            for (;;) {
                const group = this.parseTodoGroup();
                if (group.length) todoGroups.push(group);
                if (this.peek() === '|') {
                    this.pos++;
                    continue;
                }
                break;
            }
            result.todo = { onlyNotDone, groups: todoGroups };
        }

        this.skipSpace();
        if (!this.done) this.fail(`Unexpected "${this.peek()}"`);
        return result;
    }
}

function compileRegex(source: string, column: number): RegExp {
    if (source.length > MAX_REGEX_LENGTH) {
        throw new MatchSyntaxError(`Regular expression longer than ${MAX_REGEX_LENGTH} characters`, column);
    }
    try {
        return new RegExp(source);
    } catch (e) {
        throw new MatchSyntaxError(`Invalid regular expression: ${(e as Error).message}`, column);
    }
}

function checkedDate(expr: string, column: number): MatchValue {
    if (!resolveDateExpr(expr, new Date())) {
        throw new MatchSyntaxError(`Unrecognized date "<${expr}>"`, column);
    }
    return { kind: 'date', expr };
}

/** Parse a match string into its AST. Throws nothing; errors carry a 1-based column. */
export function parseMatch(src: string): { ok: true; parsed: ParsedMatch } | { ok: false; error: string; column: number } {
    if (src.length > MAX_MATCH_LENGTH) {
        return { ok: false, error: `Match string longer than ${MAX_MATCH_LENGTH} characters`, column: 1 };
    }
    try {
        return { ok: true, parsed: new Parser(src).parse() };
    } catch (e) {
        if (e instanceof MatchSyntaxError) return { ok: false, error: e.message, column: e.column + 1 };
        throw e;
    }
}

// =============================================================================
// Values
// =============================================================================

/**
 * Minutes in an Org duration: `1:30`, `0:45`, `90min`, `2h`, `1d`, `1w`,
 * `1h30min`. A day is 1440 minutes, as in org-duration-units.
 */
export function parseDuration(raw: string): number | undefined {
    const s = raw.trim();
    const clock = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(s);
    if (clock) return parseInt(clock[1]) * 60 + parseInt(clock[2]) + (clock[3] ? parseInt(clock[3]) / 60 : 0);
    const unitMinutes: Record<string, number> = {
        min: 1, m: 1, h: 60, d: 1440, w: 10080, mon: 43200, y: 525960,
    };
    const re = /(\d+(?:\.\d+)?)\s*(min|mon|[mhdwy])/g;
    let total = 0;
    let consumed = '';
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
        total += parseFloat(m[1]) * unitMinutes[m[2]];
        consumed += m[0];
    }
    return consumed.replace(/\s/g, '') === s.replace(/\s/g, '') && consumed ? total : undefined;
}

/**
 * Resolve an Org date expression (the inside of `<...>`) to the start of a day:
 * `today`, `tomorrow`, `yesterday`, `now`, `+3d`, `-2w`, `+1m`, `2026-10-17`,
 * `2026-10-17 Sat 10:00`.
 */
export function resolveDateExpr(expr: string, now: Date): Date | undefined {
    const e = expr.trim().toLowerCase();
    const today = startOfDay(now);
    if (e === 'today' || e === 'now') return today;
    if (e === 'tomorrow') return addDays(today, 1);
    if (e === 'yesterday') return addDays(today, -1);
    const rel = /^([-+])(\d+)([dwmy]?)$/.exec(e);
    if (rel) {
        const n = parseInt(rel[2]) * (rel[1] === '-' ? -1 : 1);
        switch (rel[3]) {
            case 'w': return addWeeks(today, n);
            case 'm': return addMonths(today, n);
            case 'y': return addYears(today, n);
            default: return addDays(today, n);
        }
    }
    const abs = /^(\d{4})-(\d{2})-(\d{2})/.exec(e);
    if (abs) {
        const d = new Date(parseInt(abs[1]), parseInt(abs[2]) - 1, parseInt(abs[3]));
        return isNaN(d.getTime()) ? undefined : d;
    }
    return undefined;
}

/** A stored timestamp string (`2026-10-17 Sat 10:00`, `<2026-10-17>`) as a local day. */
export function parseStoredDate(raw: string | null | undefined): Date | undefined {
    if (!raw) return undefined;
    const m = /(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    return m ? new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])) : undefined;
}

function compare(a: number | string, b: number | string, op: MatchOp): boolean {
    switch (op) {
        case '=': return a === b;
        case '<>': return a !== b;
        case '<': return a < b;
        case '<=': return a <= b;
        case '>': return a > b;
        case '>=': return a >= b;
    }
}

/** The value of a (special or drawer) property for comparison; undefined if absent. */
function propertyValue(h: MatchableHeading, name: string, opts: Required<MatchOptions>): string | Date | number | undefined {
    switch (name) {
        case 'LEVEL': return h.level;
        case 'TODO': return h.todoState;
        case 'PRIORITY': return h.priority ?? opts.defaultPriority;
        case 'CATEGORY': return h.category;
        case 'ITEM': return h.title;
        case 'SCHEDULED': return h.scheduled;
        case 'DEADLINE': return h.deadline;
        case 'CLOSED': return h.closed;
        case 'TAGS': return h.tags.length ? `:${h.tags.join(':')}:` : undefined;
        case 'ALLTAGS': {
            const all = allTags(h, opts);
            return all.length ? `:${all.join(':')}:` : undefined;
        }
    }
    for (const [k, v] of Object.entries(h.properties)) {
        if (k.toUpperCase() === name) return v;
    }
    return undefined;
}

function allTags(h: MatchableHeading, opts: Required<MatchOptions>): string[] {
    return opts.inheritTags ? [...new Set([...h.tags, ...h.inheritedTags])] : h.tags;
}

function evalProperty(
    h: MatchableHeading,
    atom: Extract<MatchAtom, { kind: 'property' }>,
    opts: Required<MatchOptions>
): boolean {
    const raw = propertyValue(h, atom.name, opts);
    const { op, value } = atom;

    if (value.kind === 'date') {
        // A heading without the date never compares true, except for "<>".
        const target = resolveDateExpr(value.expr, opts.now);
        const date = raw instanceof Date ? raw : typeof raw === 'string' ? parseStoredDate(raw) : undefined;
        if (!date || !target) return op === '<>';
        return compare(startOfDay(date).getTime(), target.getTime(), op);
    }

    const str = raw === undefined ? '' : raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw);

    if (value.kind === 'regex') {
        const hit = value.regex.test(str);
        return op === '=' ? hit : !hit;
    }
    if (value.kind === 'number') {
        // Org: a missing or non-numeric property reads as 0.
        const n = parseFloat(str);
        return compare(isNaN(n) ? 0 : n, value.value, op);
    }
    if (value.kind === 'duration') {
        const minutes = str === '' ? 0 : parseDuration(str) ?? (isNaN(parseFloat(str)) ? 0 : parseFloat(str));
        return compare(minutes, value.minutes, op);
    }
    return compare(str, value.value, op);
}

function evalTerm(h: MatchableHeading, term: MatchTerm, opts: Required<MatchOptions>): boolean {
    let hit: boolean;
    switch (term.atom.kind) {
        case 'tag':
            hit = allTags(h, opts).includes(term.atom.name);
            break;
        case 'tagRegex': {
            const re = term.atom.regex;
            hit = allTags(h, opts).some(t => re.test(t));
            break;
        }
        case 'property':
            hit = evalProperty(h, term.atom, opts);
            break;
    }
    return term.negate ? !hit : hit;
}

function evalTodoTerm(state: string, term: TodoTerm): boolean {
    const hit = term.atom.kind === 'state' ? state === term.atom.name : term.atom.regex.test(state);
    return term.negate ? !hit : hit;
}

/** Evaluate a parsed match against a heading. */
export function evaluateMatch(parsed: ParsedMatch, h: MatchableHeading, options: MatchOptions = {}): boolean {
    const opts: Required<MatchOptions> = {
        inheritTags: options.inheritTags ?? true,
        defaultPriority: options.defaultPriority ?? 'B',
        now: options.now ?? new Date(),
    };

    if (parsed.groups.length > 0 && !parsed.groups.some(g => g.every(t => evalTerm(h, t, opts)))) {
        return false;
    }

    if (parsed.todo) {
        if (!h.todoState) return false;
        if (parsed.todo.onlyNotDone && h.isDone) return false;
        const state = h.todoState;
        if (parsed.todo.groups.length > 0 && !parsed.todo.groups.some(g => g.every(t => evalTodoTerm(state, t)))) {
            return false;
        }
    }
    return true;
}

/** What SQL can safely pre-check for a parsed match. */
export function matchPrefilter(parsed: ParsedMatch): MatchPrefilter {
    const pre: MatchPrefilter = {};

    // Only a single OR-group constrains every match.
    if (parsed.groups.length === 1) {
        const group = parsed.groups[0];
        const tags = group
            .filter(t => !t.negate && t.atom.kind === 'tag')
            .map(t => (t.atom as { name: string }).name);
        if (tags.length) pre.requiredTags = tags;
        const level = group.find(t =>
            !t.negate && t.atom.kind === 'property' && t.atom.name === 'LEVEL'
            && t.atom.op === '=' && t.atom.value.kind === 'number');
        if (level && level.atom.kind === 'property' && level.atom.value.kind === 'number') {
            pre.level = level.atom.value.value;
        }
        const todo = group.find(t =>
            !t.negate && t.atom.kind === 'property' && t.atom.name === 'TODO'
            && t.atom.op === '=' && t.atom.value.kind === 'string');
        if (todo && todo.atom.kind === 'property' && todo.atom.value.kind === 'string') {
            pre.todoStates = [todo.atom.value.value];
        }
    }

    if (parsed.todo) {
        pre.requireTodo = true;
        if (parsed.todo.onlyNotDone) pre.excludeDone = true;
        // `/A|B|C`: each group a single positive keyword.
        const groups = parsed.todo.groups;
        if (groups.length > 0 && groups.every(g => g.length === 1 && !g[0].negate && g[0].atom.kind === 'state')) {
            const states = groups.map(g => (g[0].atom as { name: string }).name);
            pre.todoStates = pre.todoStates ? pre.todoStates.filter(s => states.includes(s)) : states;
        }
    }
    return pre;
}

/** Parse a match string and compile it to a predicate plus SQL prefilter. */
export function compileMatch(src: string, options: MatchOptions = {}): CompiledMatch {
    const result = parseMatch(src);
    if (!result.ok) return result;
    const parsed = result.parsed;
    return {
        ok: true,
        parsed,
        predicate: (h: MatchableHeading) => evaluateMatch(parsed, h, options),
        prefilter: matchPrefilter(parsed),
    };
}

/**
 * Parse the match of a `todo` block: a `|`-separated keyword list
 * (`TODO|NEXT`), as in org-agenda's todo search. Empty means every not-done
 * keyword.
 */
export function parseTodoKeywords(src: string): string[] {
    return src.split('|').map(s => s.trim()).filter(s => s.length > 0);
}
