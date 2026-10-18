/**
 * Custom agenda commands: the org-agenda-custom-commands analogue.
 *
 * A command is a key, a description and one or more blocks; each block is an
 * agenda, a TODO list, a tag/property match, a text search or a stuck-project
 * list. Running a command evaluates its blocks against a data source and
 * renders them, one after another, into a single agenda buffer.
 *
 *   "scimax.agenda.customCommands": [
 *     { "key": "w", "description": "Work",
 *       "blocks": [
 *         { "type": "agenda", "span": 1 },
 *         { "type": "tags-todo", "match": "+work-someday", "header": "Work tasks" }
 *       ] }
 *   ]
 *
 * The engine is free of vscode imports: the extension and the CLI each supply
 * a CustomAgendaSource over their database.
 */

// Per-function imports: the package index loads all of date-fns.
import format from 'date-fns/format';
import addDays from 'date-fns/addDays';
import startOfDay from 'date-fns/startOfDay';
import startOfWeek from 'date-fns/startOfWeek';
import * as path from 'path';
import type { HeadingRecord } from '../database/scimaxDbCore';
import {
    filterAgendaItems,
    formatAgendaItem,
    type AgendaGroup,
    type AgendaItem,
    type AgendaView,
    type AgendaViewConfig,
} from './orgAgenda';
import {
    compileMatch,
    parseDuration,
    parseTodoKeywords,
    type MatchableHeading,
    type MatchPrefilter,
    type ParsedMatch,
    evaluateMatch,
} from './orgAgendaMatch';
import { headingToAgendaItem } from './orgAgendaDb';
import { parseHeadingTags } from '../org/agendaTags';

// =============================================================================
// Configuration types
// =============================================================================

export type CustomBlockType = 'agenda' | 'todo' | 'alltodo' | 'tags' | 'tags-todo' | 'search' | 'stuck';

export const CUSTOM_BLOCK_TYPES: readonly CustomBlockType[] = [
    'agenda', 'todo', 'alltodo', 'tags', 'tags-todo', 'search', 'stuck',
];

/**
 * Declarative skip conditions, after org-agenda-skip-entry-if. An entry is
 * skipped when ANY condition holds.
 */
export interface CustomSkip {
    /** Skip entries with a SCHEDULED date */
    scheduled?: boolean;
    /** Skip entries without a SCHEDULED date */
    notScheduled?: boolean;
    /** Skip entries with a DEADLINE */
    deadline?: boolean;
    /** Skip entries without a DEADLINE */
    notDeadline?: boolean;
    /** Skip entries in one of these TODO states ("todo" / "done" = any not-done / done state) */
    todo?: string[];
    /** Skip entries NOT in one of these TODO states */
    notTodo?: string[];
    /** Skip entries with any of these tags (own or inherited) */
    tags?: string[];
    /** Skip entries with none of these tags */
    notTags?: string[];
    /** Skip entries whose heading or body matches this regex */
    regexp?: string;
    /** Skip entries whose heading and body do not match this regex */
    notRegexp?: string;
    /** Skip entries with an unfinished dependency */
    blocked?: boolean;
}

export type CustomSortKey =
    | 'time-up' | 'time-down'
    | 'priority-up' | 'priority-down'
    | 'deadline-up' | 'deadline-down'
    | 'scheduled-up' | 'scheduled-down'
    | 'effort-up' | 'effort-down'
    | 'alpha-up' | 'alpha-down'
    | 'todo-state-up' | 'todo-state-down'
    | 'category-up' | 'category-down' | 'category-keep'
    | 'level-up' | 'level-down';

export const CUSTOM_SORT_KEYS: readonly CustomSortKey[] = [
    'time-up', 'time-down', 'priority-up', 'priority-down', 'deadline-up', 'deadline-down',
    'scheduled-up', 'scheduled-down', 'effort-up', 'effort-down', 'alpha-up', 'alpha-down',
    'todo-state-up', 'todo-state-down', 'category-up', 'category-down', 'category-keep',
    'level-up', 'level-down',
];

export type CustomGroupBy = 'none' | 'todo' | 'category' | 'priority' | 'tag' | 'file';

/** Settings a block may carry, and a command may set as defaults for its blocks. */
export interface CustomBlockSettings {
    /** agenda: days shown (1 = day, 7 = week) */
    span?: number;
    /** agenda: "today", a weekday ("monday"), a relative offset ("-1d") or yyyy-mm-dd */
    startDay?: string;
    /** Restrict to these files (absolute, or ~/ paths) */
    files?: string[];
    /** Restrict to files under these directories */
    directories?: string[];
    /** Include done entries (tags, todo, search) */
    showDone?: boolean;
    /** Count inherited tags in matches; default true (org-use-tag-inheritance) */
    inheritTags?: boolean;
    /** Group a list block's entries */
    groupBy?: CustomGroupBy;
    /** Sorting strategy, applied in order */
    sort?: CustomSortKey[];
    /** Skip conditions */
    skip?: CustomSkip;
    /** Line prefix: %c category, %t time, %s schedule info, %e effort, %f file, %l level */
    prefix?: string;
    /** Stop after this many entries */
    limit?: number;
}

export interface CustomBlock extends CustomBlockSettings {
    type: CustomBlockType;
    /** Match string (tags, tags-todo, agenda), keyword list (todo), or search words (search) */
    match?: string;
    /** Section header; defaults to a description of the block */
    header?: string;
}

export interface CustomAgendaCommand extends Partial<CustomBlock> {
    /** Dispatcher key, e.g. "w"; a multi-character key "gw" lives under prefix "g" */
    key: string;
    description?: string;
    /** Blocks of a composite view; or give type/match directly for a single block */
    blocks?: CustomBlock[];
    /** Defaults applied to every block */
    settings?: CustomBlockSettings;
    /** Files written by "Store Agenda Views" (.txt, .org, .html, .ics, .json) */
    export?: string[];
}

/** Stuck-project definition, after org-stuck-projects. */
export interface StuckProjectsConfig {
    /** Match string selecting project headings (done headings are never stuck) */
    match: string;
    /** A project with a descendant in one of these states is not stuck */
    todoStates: string[];
    /** ... or with a descendant carrying one of these tags */
    tags: string[];
    /** ... or whose subtree title matches this regex */
    regexp?: string;
}

export const DEFAULT_STUCK_PROJECTS: StuckProjectsConfig = {
    match: 'LEVEL=2',
    todoStates: ['TODO', 'NEXT', 'NEXTACTION'],
    tags: [],
};

/** A command after validation: blocks resolved, settings merged, matches compiled. */
export interface ResolvedCommand {
    key: string;
    description: string;
    /** A prefix entry only opens a submenu */
    isPrefix: boolean;
    blocks: ResolvedBlock[];
    export: string[];
    /** Validation problems; a command with errors does not run */
    errors: string[];
}

export interface ResolvedBlock extends CustomBlock {
    header: string;
    /** Compiled match (tags, tags-todo, agenda, stuck); undefined when match is empty */
    parsed?: ParsedMatch;
    prefilter: MatchPrefilter;
    /** todo: keywords; empty = every not-done keyword */
    keywords: string[];
    skipRegexp?: RegExp;
    skipNotRegexp?: RegExp;
}

// =============================================================================
// Validation
// =============================================================================

const MAX_COMMANDS = 200;
const MAX_BLOCKS = 20;

function blockDescription(block: CustomBlock): string {
    const m = block.match?.trim();
    switch (block.type) {
        case 'agenda': return m ? `Agenda: ${m}` : 'Agenda';
        case 'todo': return m ? `TODO: ${m}` : 'Global list of TODO items';
        case 'alltodo': return 'Global list of TODO items';
        case 'tags': return `Headlines with tags matching: ${m ?? ''}`;
        case 'tags-todo': return `TODO headlines with tags matching: ${m ?? ''}`;
        case 'search': return `Search words: ${m ?? ''}`;
        case 'stuck': return 'Stuck projects';
    }
}

function expandHome(p: string, home: string): string {
    return p === '~' ? home : p.startsWith('~/') ? path.join(home, p.slice(2)) : p;
}

/**
 * Validate commands from settings. Never throws: problems are reported on
 * each command (and in `problems` for ones too broken to list).
 */
export function resolveCustomCommands(
    raw: unknown,
    options: { home?: string; stuck?: StuckProjectsConfig } = {}
): { commands: ResolvedCommand[]; problems: string[] } {
    const problems: string[] = [];
    if (raw === undefined || raw === null) return { commands: [], problems };
    if (!Array.isArray(raw)) {
        return { commands: [], problems: ['scimax.agenda.customCommands must be an array'] };
    }

    const home = options.home ?? '';
    const stuckMatch = options.stuck?.match ?? DEFAULT_STUCK_PROJECTS.match;
    const commands: ResolvedCommand[] = [];
    const seen = new Set<string>();

    for (const [index, entry] of raw.slice(0, MAX_COMMANDS).entries()) {
        if (!entry || typeof entry !== 'object' || typeof (entry as CustomAgendaCommand).key !== 'string') {
            problems.push(`Entry ${index + 1}: needs a "key" string`);
            continue;
        }
        const cmd = entry as CustomAgendaCommand;
        const key = cmd.key.trim();
        const errors: string[] = [];
        if (!key) {
            problems.push(`Entry ${index + 1}: "key" is empty`);
            continue;
        }
        if (seen.has(key)) errors.push(`Duplicate key "${key}"`);
        seen.add(key);

        // Block settings written on the command itself, beside "settings"
        const own: Record<string, unknown> = { ...cmd };
        for (const field of ['key', 'description', 'blocks', 'settings', 'export']) delete own[field];

        let blockSpecs: CustomBlock[];
        let defaults: CustomBlockSettings;
        if (Array.isArray(cmd.blocks)) {
            blockSpecs = cmd.blocks;
            // In a composite view these are defaults for every block; type, match
            // and header belong to each block.
            for (const field of ['type', 'match', 'header']) delete own[field];
            defaults = { ...cmd.settings, ...own, skip: { ...cmd.settings?.skip, ...(own as CustomBlockSettings).skip } };
        } else if (cmd.type) {
            blockSpecs = [own as unknown as CustomBlock];
            defaults = { ...cmd.settings };
        } else {
            blockSpecs = [];
            defaults = {};
        }
        if (blockSpecs.length > MAX_BLOCKS) {
            errors.push(`More than ${MAX_BLOCKS} blocks`);
            blockSpecs = blockSpecs.slice(0, MAX_BLOCKS);
        }

        const blocks: ResolvedBlock[] = [];
        for (const [bi, spec] of blockSpecs.entries()) {
            const where = blockSpecs.length > 1 ? `Block ${bi + 1}: ` : '';
            if (!spec || typeof spec !== 'object' || !CUSTOM_BLOCK_TYPES.includes(spec.type)) {
                errors.push(`${where}unknown block type "${(spec as CustomBlock | undefined)?.type}"`
                    + ` (expected one of ${CUSTOM_BLOCK_TYPES.join(', ')})`);
                continue;
            }
            const merged: CustomBlock = { ...defaults, ...spec, skip: { ...defaults.skip, ...spec.skip } };
            if (merged.files) merged.files = merged.files.map(f => expandHome(f, home));
            if (merged.directories) merged.directories = merged.directories.map(d => expandHome(d, home));
            if (merged.sort) {
                const bad = merged.sort.filter(s => !CUSTOM_SORT_KEYS.includes(s));
                if (bad.length) errors.push(`${where}unknown sort key ${bad.map(b => `"${b}"`).join(', ')}`);
                merged.sort = merged.sort.filter(s => CUSTOM_SORT_KEYS.includes(s));
            }
            if (merged.span !== undefined && (!Number.isInteger(merged.span) || merged.span < 1 || merged.span > 366)) {
                errors.push(`${where}span must be a whole number of days from 1 to 366`);
            }
            if (merged.startDay && !resolveStartDay(merged.startDay, new Date())) {
                errors.push(`${where}unrecognized startDay "${merged.startDay}"`);
            }

            const block: ResolvedBlock = {
                ...merged,
                header: spec.header ?? blockDescription(merged),
                prefilter: {},
                keywords: [],
            };

            const matchSrc = merged.type === 'stuck' ? stuckMatch : (merged.match ?? '').trim();
            if (merged.type === 'todo') {
                block.keywords = parseTodoKeywords(matchSrc);
            } else if (merged.type !== 'alltodo' && merged.type !== 'search' && matchSrc) {
                const compiled = compileMatch(matchSrc);
                if (!compiled.ok) {
                    errors.push(`${where}match "${matchSrc}": ${compiled.error} (column ${compiled.column})`);
                } else {
                    block.parsed = compiled.parsed;
                    block.prefilter = compiled.prefilter;
                }
            }
            if (merged.type === 'search' && !matchSrc) errors.push(`${where}a search block needs "match" words`);

            for (const [field, value] of [['regexp', merged.skip?.regexp], ['notRegexp', merged.skip?.notRegexp]] as const) {
                if (!value) continue;
                try {
                    const re = new RegExp(value, 'm');
                    if (field === 'regexp') block.skipRegexp = re;
                    else block.skipNotRegexp = re;
                } catch (e) {
                    errors.push(`${where}skip.${field}: ${(e as Error).message}`);
                }
            }
            blocks.push(block);
        }

        const isPrefix = blockSpecs.length === 0;
        commands.push({
            key,
            description: cmd.description ?? (isPrefix ? `Prefix ${key}` : blocks[0]?.header ?? key),
            isPrefix,
            blocks,
            export: (cmd.export ?? []).map(f => expandHome(f, home)),
            errors,
        });
    }

    if (raw.length > MAX_COMMANDS) problems.push(`Only the first ${MAX_COMMANDS} custom commands are used`);
    return { commands, problems };
}

/** Resolve a block's startDay against today. */
export function resolveStartDay(startDay: string | undefined, now: Date): Date | undefined {
    const today = startOfDay(now);
    const s = (startDay ?? 'today').trim().toLowerCase();
    if (s === 'today') return today;
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const weekday = days.indexOf(s);
    if (weekday >= 0) return startOfWeek(today, { weekStartsOn: weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6 });
    const rel = /^([-+])(\d+)d?$/.exec(s);
    if (rel) return addDays(today, parseInt(rel[2]) * (rel[1] === '-' ? -1 : 1));
    const abs = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (abs) {
        const d = new Date(parseInt(abs[1]), parseInt(abs[2]) - 1, parseInt(abs[3]));
        return isNaN(d.getTime()) ? undefined : d;
    }
    return undefined;
}

/**
 * The commands to offer at a dispatcher level: those one character longer
 * than the prefix and starting with it.
 */
export function commandsUnderPrefix(commands: ResolvedCommand[], prefix: string): ResolvedCommand[] {
    return commands.filter(c => c.key.length === prefix.length + 1 && c.key.startsWith(prefix));
}

// =============================================================================
// Data source
// =============================================================================

/** Database access the engine needs; the extension and CLI each provide one. */
export interface CustomAgendaSource {
    /** A dated agenda (one group per day), already filtered for excluded files */
    agendaView(config: Partial<AgendaViewConfig>): Promise<AgendaView>;
    /** Heading rows that may satisfy the prefilter */
    headings(prefilter: MatchPrefilter & { inheritTags: boolean } & BlockScope): Promise<HeadingRecord[]>;
    /** Every heading of one file in document order */
    headingsInFile(file: string): Promise<HeadingRecord[]>;
    /** Headings whose title or body contains all words (a candidate set for search blocks) */
    searchHeadings(words: string[], scope?: BlockScope): Promise<HeadingRecord[]>;
    /** A file's text, for body regexps; undefined if unreadable */
    readFile(file: string): Promise<string | undefined>;
    /** Excluded from the agenda by the user */
    isExcluded(file: string): boolean;
    /** Done per settings (the file's #+TODO line is in todo_type) */
    isDone(heading: HeadingRecord): boolean;
    /** Unfinished dependency; only asked when a skip needs it */
    isBlocked?(item: AgendaItem): Promise<boolean>;
    /** Stuck-project definition */
    stuckProjects: StuckProjectsConfig;
}

// =============================================================================
// Running
// =============================================================================

export interface CustomBlockResult {
    header: string;
    block: ResolvedBlock;
    groups: AgendaGroup[];
    totalItems: number;
    /** agenda blocks: the date range shown */
    dateRange?: { start: Date; end: Date };
}

export interface CustomCommandResult {
    command: ResolvedCommand;
    blocks: CustomBlockResult[];
    generatedAt: Date;
}

export interface RunOptions {
    now?: Date;
    /** Spans paged forward (+) or back (-), for agenda blocks */
    offset?: number;
}

function asMatchable(item: AgendaItem): MatchableHeading {
    return {
        title: item.title,
        todoState: item.todoState,
        isDone: item.isDone ?? false,
        priority: item.priority,
        level: item.level ?? item.headline?.properties.level ?? 1,
        tags: item.tags,
        inheritedTags: item.inheritedTags ?? [],
        category: item.category,
        properties: item.properties ?? item.headline?.propertiesDrawer ?? {},
        scheduled: item.scheduled,
        deadline: item.deadline,
        closed: item.closed,
    };
}

function effortMinutes(item: AgendaItem): number | undefined {
    const props = item.properties ?? item.headline?.propertiesDrawer ?? {};
    for (const [k, v] of Object.entries(props)) {
        if (k.toUpperCase() === 'EFFORT') return parseDuration(v);
    }
    return undefined;
}

function allTags(item: AgendaItem): string[] {
    return [...item.tags, ...(item.inheritedTags ?? [])];
}

/** The body of the entry at a 1-based line: the heading up to the next heading. */
export function entryText(fileText: string, line: number): string {
    const lines = fileText.split(/\r?\n/);
    const out: string[] = [];
    for (let i = line - 1; i < lines.length; i++) {
        if (i > line - 1 && /^\*+\s/.test(lines[i])) break;
        out.push(lines[i]);
    }
    return out.join('\n');
}

/** True if a skip condition drops the item. */
export async function shouldSkip(
    item: AgendaItem,
    block: ResolvedBlock,
    source: Pick<CustomAgendaSource, 'readFile' | 'isBlocked'>,
    fileCache: Map<string, string | undefined>
): Promise<boolean> {
    const skip = block.skip;
    if (!skip) return false;

    // An agenda entry carries only the date it is placed by; the other
    // planning date comes from properties of the heading row, when known.
    const scheduled = item.scheduled ?? item.headline?.planning?.properties.scheduled;
    const deadline = item.deadline ?? item.headline?.planning?.properties.deadline;
    if (skip.scheduled && scheduled) return true;
    if (skip.notScheduled && !scheduled) return true;
    if (skip.deadline && deadline) return true;
    if (skip.notDeadline && !deadline) return true;

    const inStates = (states: string[]) => states.some(s =>
        s === 'todo' ? !!item.todoState && !item.isDone
            : s === 'done' ? !!item.isDone
                : item.todoState === s);
    if (skip.todo?.length && inStates(skip.todo)) return true;
    if (skip.notTodo?.length && !inStates(skip.notTodo)) return true;

    const tags = allTags(item);
    if (skip.tags?.length && skip.tags.some(t => tags.includes(t))) return true;
    if (skip.notTags?.length && !skip.notTags.some(t => tags.includes(t))) return true;

    if (block.skipRegexp || block.skipNotRegexp) {
        if (!fileCache.has(item.file)) fileCache.set(item.file, await source.readFile(item.file));
        const text = fileCache.get(item.file);
        const body = text !== undefined ? entryText(text, item.line) : item.title;
        if (block.skipRegexp && block.skipRegexp.test(body)) return true;
        if (block.skipNotRegexp && !block.skipNotRegexp.test(body)) return true;
    }

    if (skip.blocked) {
        const blocked = item.blocked ?? (source.isBlocked ? await source.isBlocked(item) : false);
        if (blocked) return true;
    }
    return false;
}

const PRIORITY_RANK = (p: string | undefined) => (p ? p.charCodeAt(0) : 'B'.charCodeAt(0));

function itemTime(item: AgendaItem): number | undefined {
    const date = item.scheduled ?? item.deadline ?? item.timestamp;
    if (!date) return undefined;
    const t = item.time ? /^(\d{1,2}):(\d{2})/.exec(item.time) : null;
    return date.getTime() + (t ? (parseInt(t[1]) * 60 + parseInt(t[2])) * 60000 : 0);
}

/** Compare with undefined last in either direction, as Org does. */
function cmpOptional(a: number | undefined, b: number | undefined, dir: 1 | -1): number {
    if (a === undefined && b === undefined) return 0;
    if (a === undefined) return 1;
    if (b === undefined) return -1;
    return (a - b) * dir;
}

/** Sort by an org-agenda-sorting-strategy-like list. Stable. */
export function sortItems(items: AgendaItem[], strategy: CustomSortKey[] | undefined, todoOrder: string[] = []): AgendaItem[] {
    if (!strategy?.length) return items;
    const indexed = items.map((item, i) => ({ item, i }));
    // category-keep: categories in order of first appearance.
    const categoryOrder = new Map<string, number>();
    for (const item of items) {
        const c = item.category ?? '';
        if (!categoryOrder.has(c)) categoryOrder.set(c, categoryOrder.size);
    }
    const todoRank = (s: string | undefined) => {
        if (!s) return undefined;
        const i = todoOrder.indexOf(s);
        return i >= 0 ? i : todoOrder.length + s.charCodeAt(0);
    };

    indexed.sort((x, y) => {
        const a = x.item;
        const b = y.item;
        for (const key of strategy) {
            const [field, direction] = key.split(/-(?=up$|down$|keep$)/);
            const dir: 1 | -1 = direction === 'down' ? -1 : 1;
            let c = 0;
            switch (field) {
                case 'time': c = cmpOptional(itemTime(a), itemTime(b), dir); break;
                // Higher priority (A) first for priority-down, as in Org.
                case 'priority': c = (PRIORITY_RANK(a.priority) - PRIORITY_RANK(b.priority)) * -dir; break;
                case 'deadline': c = cmpOptional(a.deadline?.getTime(), b.deadline?.getTime(), dir); break;
                case 'scheduled': c = cmpOptional(a.scheduled?.getTime(), b.scheduled?.getTime(), dir); break;
                case 'effort': c = cmpOptional(effortMinutes(a), effortMinutes(b), dir); break;
                case 'alpha': c = a.title.localeCompare(b.title) * dir; break;
                case 'todo-state': c = cmpOptional(todoRank(a.todoState), todoRank(b.todoState), dir); break;
                case 'level': c = ((a.level ?? 1) - (b.level ?? 1)) * dir; break;
                case 'category':
                    c = direction === 'keep'
                        ? (categoryOrder.get(a.category ?? '')! - categoryOrder.get(b.category ?? '')!)
                        : (a.category ?? '').localeCompare(b.category ?? '') * dir;
                    break;
            }
            if (c !== 0) return c;
        }
        return x.i - y.i;
    });
    return indexed.map(x => x.item);
}

/** Group a list block's items. */
export function groupList(items: AgendaItem[], groupBy: CustomGroupBy | undefined, header: string): AgendaGroup[] {
    if (!groupBy || groupBy === 'none') return [{ label: header, key: 'all', items }];
    const groups = new Map<string, AgendaItem[]>();
    for (const item of items) {
        let key: string;
        switch (groupBy) {
            case 'todo': key = item.todoState ?? '(no state)'; break;
            case 'category': key = item.category ?? '(none)'; break;
            case 'priority': key = item.priority ? `Priority ${item.priority}` : 'No priority'; break;
            case 'tag': key = allTags(item)[0] ?? 'Untagged'; break;
            case 'file': key = path.basename(item.file); break;
        }
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
    }
    const entries = [...groups.entries()];
    if (groupBy === 'priority') {
        // Priority A first, entries without a priority last
        const rank = (key: string) => (key === 'No priority' ? '\uffff' : key);
        entries.sort(([a], [b]) => rank(a).localeCompare(rank(b)));
    }
    return entries.map(([key, groupItems]) => ({ label: key, key, items: groupItems }));
}

/** A block's file restriction, passed to the source so it applies before the row limit. */
export interface BlockScope {
    files?: string[];
    directories?: string[];
}

function blockScope(block: ResolvedBlock): BlockScope {
    return {
        ...(block.files?.length ? { files: block.files } : {}),
        ...(block.directories?.length ? { directories: block.directories } : {}),
    };
}

function inScope(file: string, block: ResolvedBlock): boolean {
    if (block.files?.length && !block.files.includes(file)) return false;
    if (block.directories?.length) {
        return block.directories.some(dir => {
            const rel = path.relative(dir, file);
            return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
        });
    }
    return true;
}

/** Search words: bare words and +word must appear, -word must not, {regex} must match. */
export function parseSearchWords(src: string): { required: string[]; excluded: string[]; regexes: RegExp[]; error?: string } {
    const required: string[] = [];
    const excluded: string[] = [];
    const regexes: RegExp[] = [];
    const tokens = src.match(/[-+]?\{[^}]*\}|[-+]?"[^"]*"|\S+/g) ?? [];
    for (const raw of tokens) {
        let tok = raw;
        let negate = false;
        if (tok.startsWith('-') && tok.length > 1) { negate = true; tok = tok.slice(1); }
        else if (tok.startsWith('+') && tok.length > 1) tok = tok.slice(1);
        if (tok.startsWith('{') && tok.endsWith('}')) {
            try {
                regexes.push(new RegExp(tok.slice(1, -1), 'i'));
            } catch (e) {
                return { required, excluded, regexes, error: (e as Error).message };
            }
            continue;
        }
        if (tok.startsWith('"') && tok.endsWith('"')) tok = tok.slice(1, -1);
        if (!tok) continue;
        (negate ? excluded : required).push(tok.toLowerCase());
    }
    return { required, excluded, regexes };
}

async function runListBlock(
    block: ResolvedBlock,
    source: CustomAgendaSource,
    now: Date,
    fileCache: Map<string, string | undefined>
): Promise<AgendaItem[]> {
    const inheritTags = block.inheritTags ?? true;
    const prefilter: MatchPrefilter & { inheritTags: boolean } & BlockScope = { ...block.prefilter, inheritTags, ...blockScope(block) };
    const todoOnly = block.type === 'todo' || block.type === 'alltodo' || block.type === 'tags-todo';
    if (todoOnly) {
        prefilter.requireTodo = true;
        if (!block.showDone) prefilter.excludeDone = true;
    }
    if (block.type === 'todo' && block.keywords.length) prefilter.todoStates = block.keywords;

    let rows: HeadingRecord[];
    let search: ReturnType<typeof parseSearchWords> | undefined;
    if (block.type === 'search') {
        search = parseSearchWords(block.match ?? '');
        rows = await source.searchHeadings(search.required, blockScope(block));
    } else {
        rows = await source.headings(prefilter);
    }

    const items: AgendaItem[] = [];
    for (const row of rows) {
        if (source.isExcluded(row.file_path) || !inScope(row.file_path, block)) continue;
        const done = source.isDone(row);
        if (todoOnly && (!row.todo_state || (!block.showDone && done))) continue;
        if (block.type === 'todo' && block.keywords.length && !block.keywords.includes(row.todo_state ?? '')) continue;
        if (block.type === 'tags' && !block.showDone && done) continue;
        if (block.type === 'search' && !block.showDone && done) continue;

        const item = headingToAgendaItem(row, done);
        if (block.parsed && !evaluateMatch(block.parsed, asMatchable(item), { inheritTags, now })) continue;

        if (search) {
            if (!fileCache.has(item.file)) fileCache.set(item.file, await source.readFile(item.file));
            const text = fileCache.get(item.file);
            const body = (text !== undefined ? entryText(text, item.line) : item.title).toLowerCase();
            if (!search.required.every(w => body.includes(w))) continue;
            if (search.excluded.some(w => body.includes(w))) continue;
            if (!search.regexes.every(re => re.test(body))) continue;
        }

        if (await shouldSkip(item, block, source, fileCache)) continue;
        items.push(item);
    }
    return items;
}

/**
 * Projects (headings matching the stuck match) with no descendant that shows
 * a next action: a heading in one of the given states, with one of the tags,
 * or with a title matching the regexp.
 */
async function runStuckBlock(
    block: ResolvedBlock,
    source: CustomAgendaSource,
    now: Date,
    fileCache: Map<string, string | undefined>
): Promise<AgendaItem[]> {
    const stuck = source.stuckProjects;
    const inheritTags = block.inheritTags ?? true;
    const candidates = await source.headings({ ...block.prefilter, inheritTags, ...blockScope(block) });
    let regexp: RegExp | undefined;
    if (stuck.regexp) {
        try { regexp = new RegExp(stuck.regexp); } catch { regexp = undefined; }
    }

    const byFile = new Map<string, HeadingRecord[]>();
    const items: AgendaItem[] = [];
    for (const row of candidates) {
        if (source.isExcluded(row.file_path) || !inScope(row.file_path, block)) continue;
        const done = source.isDone(row);
        if (done) continue;
        const item = headingToAgendaItem(row, done);
        if (block.parsed && !evaluateMatch(block.parsed, asMatchable(item), { inheritTags, now })) continue;

        if (!byFile.has(row.file_path)) byFile.set(row.file_path, await source.headingsInFile(row.file_path));
        const outline = byFile.get(row.file_path)!;
        const start = outline.findIndex(h => h.line_number === row.line_number);
        let active = false;
        for (let i = start + 1; start >= 0 && i < outline.length && outline[i].level > row.level; i++) {
            const d = outline[i];
            const dTags = parseHeadingTags(d.tags);
            if ((d.todo_state && stuck.todoStates.includes(d.todo_state) && !source.isDone(d))
                || stuck.tags.some(t => dTags.includes(t))
                || (regexp && regexp.test(d.title))) {
                active = true;
                break;
            }
        }
        if (active) continue;
        if (await shouldSkip(item, block, source, fileCache)) continue;
        items.push(item);
    }
    return items;
}

async function runAgendaBlock(
    block: ResolvedBlock,
    source: CustomAgendaSource,
    now: Date,
    offset: number,
    fileCache: Map<string, string | undefined>
): Promise<CustomBlockResult> {
    const span = block.span ?? 7;
    const base = resolveStartDay(block.startDay, now) ?? startOfDay(now);
    const startDate = addDays(base, offset * span);
    const view = await source.agendaView({
        type: span === 1 ? 'day' : span === 7 ? 'week' : 'custom',
        startDate,
        days: span,
        files: block.files,
        directories: block.directories,
    });

    const inheritTags = block.inheritTags ?? true;
    const groups: AgendaGroup[] = [];
    for (const group of view.groups) {
        const kept: AgendaItem[] = [];
        for (const item of group.items) {
            if (block.files?.length || block.directories?.length) {
                if (!inScope(item.file, block)) continue;
            }
            if (block.parsed && !evaluateMatch(block.parsed, asMatchable(item), { inheritTags, now })) continue;
            if (await shouldSkip(item, block, source, fileCache)) continue;
            kept.push(item);
        }
        groups.push({ ...group, items: sortItems(kept, block.sort) });
    }
    const limited = applyLimit(groups, block.limit);
    return {
        header: block.header,
        block,
        groups: limited,
        totalItems: limited.reduce((n, g) => n + g.items.length, 0),
        dateRange: view.dateRange,
    };
}

function applyLimit(groups: AgendaGroup[], limit: number | undefined): AgendaGroup[] {
    if (!limit || limit < 1) return groups;
    let left = limit;
    return groups.map(g => {
        const items = g.items.slice(0, Math.max(0, left));
        left -= items.length;
        return { ...g, items };
    });
}

/** Run a resolved command's blocks in order. */
export async function runCustomCommand(
    command: ResolvedCommand,
    source: CustomAgendaSource,
    options: RunOptions = {}
): Promise<CustomCommandResult> {
    const now = options.now ?? new Date();
    const offset = options.offset ?? 0;
    const fileCache = new Map<string, string | undefined>();
    const blocks: CustomBlockResult[] = [];

    for (const block of command.blocks) {
        if (block.type === 'agenda') {
            blocks.push(await runAgendaBlock(block, source, now, offset, fileCache));
            continue;
        }
        const raw = block.type === 'stuck'
            ? await runStuckBlock(block, source, now, fileCache)
            : await runListBlock(block, source, now, fileCache);
        const sorted = sortItems(raw, block.sort ?? ['priority-down', 'category-keep']);
        const limited = block.limit && block.limit > 0 ? sorted.slice(0, block.limit) : sorted;
        blocks.push({
            header: block.header,
            block,
            groups: groupList(limited, block.groupBy, block.header),
            totalItems: limited.length,
        });
    }
    return { command, blocks, generatedAt: now };
}

/** Narrow a view by the standard config filters (exposed for sources). */
export function filterView(view: AgendaView, config: AgendaViewConfig): AgendaView {
    const groups = view.groups.map(g => ({ ...g, items: filterAgendaItems(g.items, config) }));
    return { ...view, groups, totalItems: groups.reduce((n, g) => n + g.items.length, 0) };
}

// =============================================================================
// Rendering
// =============================================================================

/** Format an item with a block's prefix format, or the default agenda line. */
export function formatCustomItem(item: AgendaItem, prefix: string | undefined): string {
    if (!prefix) return formatAgendaItem(item);
    const schedule = (() => {
        switch (item.agendaType) {
            case 'scheduled': return 'Scheduled:';
            case 'deadline':
                if (item.overdue) return `${Math.abs(item.daysUntil ?? 0)} d. ago:`;
                return item.daysUntil === 0 ? 'Deadline:' : `In ${item.daysUntil} d.:`;
            default: return '';
        }
    })();
    const effort = effortMinutes(item);
    const head = prefix.replace(/%(-?\d*)([ctsefl%])/g, (_m, width: string, code: string) => {
        let value: string;
        switch (code) {
            case 'c': value = item.category ? `${item.category}:` : ''; break;
            case 't': value = item.time ?? ''; break;
            case 's': value = schedule; break;
            case 'e': value = effort !== undefined ? `${Math.floor(effort / 60)}:${String(Math.round(effort % 60)).padStart(2, '0')}` : ''; break;
            case 'f': value = path.basename(item.file); break;
            case 'l': value = '  '.repeat(Math.max(0, (item.level ?? 1) - 1)); break;
            default: return '%';
        }
        const n = parseInt(width || '0');
        if (!n) return value;
        return n < 0 ? value.padEnd(-n) : value.padStart(n);
    });
    const parts: string[] = [];
    if (item.todoState) parts.push(item.todoState);
    if (item.priority) parts.push(`[#${item.priority}]`);
    parts.push(item.blocked ? `🔒 ${item.title}` : item.title);
    if (item.tags.length) parts.push(`:${item.tags.join(':')}:`);
    const rest = parts.join(' ');
    // Keep the prefix's padding so columns line up when a field is empty
    if (!head.trim()) return rest;
    return /\s$/.test(head) ? head + rest : `${head} ${rest}`;
}

export interface RenderedCustomAgenda {
    text: string;
    /** 0-based line -> item, as for the plain agenda buffer */
    lineMap: Map<number, AgendaItem>;
}

/** Render a command's blocks as one agenda buffer. */
export function renderCustomCommand(result: CustomCommandResult): RenderedCustomAgenda {
    const lines: string[] = [];
    const lineMap = new Map<number, AgendaItem>();
    const { command } = result;

    lines.push(`${command.description}   [${command.key}]`);
    lines.push('='.repeat(70));

    for (const block of result.blocks) {
        lines.push('');
        let header = block.header;
        if (block.dateRange) {
            // dateRange.end is exclusive.
            const { start } = block.dateRange;
            const last = addDays(block.dateRange.end, -1);
            header += last > start
                ? `   ${format(start, 'MMM d')} - ${format(last, 'MMM d, yyyy')}`
                : `   ${format(start, 'EEE MMM d, yyyy')}`;
        }
        lines.push(header);
        lines.push('-'.repeat(Math.min(70, Math.max(header.length, 10))));

        const isAgenda = block.block.type === 'agenda';
        const singleGroup = !isAgenda && block.groups.length === 1 && block.groups[0].key === 'all';
        let any = false;
        for (const group of block.groups) {
            if (group.items.length === 0) continue;
            any = true;
            if (!singleGroup) lines.push(isAgenda ? group.label : `  ${group.label}`);
            for (const item of group.items) {
                lineMap.set(lines.length, item);
                lines.push('  ' + formatCustomItem(item, block.block.prefix));
            }
        }
        if (!any) lines.push('  (no entries)');
    }

    const total = result.blocks.reduce((n, b) => n + b.totalItems, 0);
    lines.push('');
    lines.push(`Total: ${total} items`);
    return { text: lines.join('\n'), lineMap };
}

// =============================================================================
// Export
// =============================================================================

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeIcs(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** A rendered agenda as a standalone HTML page. */
export function customCommandToHtml(result: CustomCommandResult): string {
    const out: string[] = [];
    out.push('<!DOCTYPE html>', '<html><head><meta charset="utf-8">',
        `<title>${escapeHtml(result.command.description)}</title>`,
        '<style>body{font-family:ui-monospace,Menlo,monospace;max-width:60rem;margin:2rem auto;padding:0 1rem}'
        + 'h2{border-bottom:1px solid #ccc;margin-top:2rem}h3{margin:1rem 0 .25rem;font-size:1rem}'
        + 'ul{list-style:none;padding-left:1rem;margin:0}.todo{color:#c00;font-weight:bold}'
        + '.done{color:#080}.tags{color:#888}.meta{color:#666}</style>',
        '</head><body>',
        `<h1>${escapeHtml(result.command.description)}</h1>`,
        `<p class="meta">Generated ${escapeHtml(format(result.generatedAt, 'yyyy-MM-dd HH:mm'))}</p>`);
    for (const block of result.blocks) {
        out.push(`<h2>${escapeHtml(block.header)}</h2>`);
        for (const group of block.groups) {
            if (!group.items.length) continue;
            if (block.groups.length > 1 || group.key !== 'all') out.push(`<h3>${escapeHtml(group.label)}</h3>`);
            out.push('<ul>');
            for (const item of group.items) {
                const state = item.todoState
                    ? `<span class="${item.isDone ? 'done' : 'todo'}">${escapeHtml(item.todoState)}</span> ` : '';
                const pri = item.priority ? `[#${escapeHtml(item.priority)}] ` : '';
                const time = item.time ? `${escapeHtml(item.time)} ` : '';
                const tags = item.tags.length ? ` <span class="tags">:${escapeHtml(item.tags.join(':'))}:</span>` : '';
                const cat = item.category ? `<span class="meta">${escapeHtml(item.category)}:</span> ` : '';
                out.push(`<li>${cat}${time}${state}${pri}${escapeHtml(item.title)}${tags}</li>`);
            }
            out.push('</ul>');
        }
    }
    out.push('</body></html>');
    return out.join('\n');
}

/** Dated entries as an iCalendar file. Undated entries are left out. */
export function customCommandToIcs(result: CustomCommandResult): string {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//scimax-vscode//custom agenda//EN'];
    const stamp = format(result.generatedAt, "yyyyMMdd'T'HHmmss");
    const seen = new Set<string>();
    for (const block of result.blocks) {
        for (const item of block.groups.flatMap(g => g.items)) {
            const date = item.scheduled ?? item.deadline ?? item.timestamp;
            if (!date) continue;
            const uid = `${item.file}:${item.line}:${item.agendaType}`;
            if (seen.has(uid)) continue;
            seen.add(uid);
            const day = format(date, 'yyyyMMdd');
            const t = item.time ? /^(\d{1,2}):(\d{2})/.exec(item.time) : null;
            lines.push('BEGIN:VEVENT');
            lines.push(`UID:${escapeIcs(uid)}`);
            lines.push(`DTSTAMP:${stamp}`);
            if (t) {
                lines.push(`DTSTART:${day}T${t[1].padStart(2, '0')}${t[2]}00`);
            } else {
                lines.push(`DTSTART;VALUE=DATE:${day}`);
            }
            const prefix = item.agendaType === 'deadline' ? 'DL: ' : item.agendaType === 'scheduled' ? 'S: ' : '';
            lines.push(`SUMMARY:${escapeIcs(prefix + (item.todoState ? `${item.todoState} ` : '') + item.title)}`);
            if (item.category) lines.push(`CATEGORIES:${escapeIcs(item.category)}`);
            lines.push('END:VEVENT');
        }
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
}

/** Export text for a file name, chosen by its extension. */
export function exportCustomCommand(result: CustomCommandResult, file: string): string {
    switch (path.extname(file).toLowerCase()) {
        case '.html':
        case '.htm':
            return customCommandToHtml(result);
        case '.ics':
            return customCommandToIcs(result);
        case '.json':
            return JSON.stringify(customCommandToJson(result), null, 2) + '\n';
        default:
            return renderCustomCommand(result).text + '\n';
    }
}

/** Exported (for tests and the CLI): JSON for a result. */
export function customCommandToJson(result: CustomCommandResult): unknown {
    const day = (d?: Date) => (d ? format(d, 'yyyy-MM-dd') : null);
    return {
        key: result.command.key,
        description: result.command.description,
        generated: result.generatedAt.toISOString(),
        blocks: result.blocks.map(b => ({
            header: b.header,
            type: b.block.type,
            count: b.totalItems,
            groups: b.groups.filter(g => g.items.length).map(g => ({
                label: g.label,
                items: g.items.map(i => ({
                    title: i.title,
                    todo_state: i.todoState ?? null,
                    priority: i.priority ?? null,
                    tags: i.tags,
                    category: i.category ?? null,
                    type: i.agendaType,
                    scheduled: day(i.scheduled),
                    deadline: day(i.deadline),
                    time: i.time ?? null,
                    file_path: i.file,
                    line_number: i.line,
                })),
            })),
        })),
    };
}
