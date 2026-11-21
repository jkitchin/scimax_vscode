/**
 * Org headings that drawings link to, without VS Code.
 *
 * The Excalidraw editor uses this to
 *  - list headings for the "Link to note" picker (scanProject),
 *  - write a durable link to a heading (linkForHeading),
 *  - find what each linked shape points at and that heading's TODO state,
 *    priority, outline path and first lines (linkStatus).
 *
 * Files are read from disk, or from `overrides` (open editors' unsaved text),
 * and cached by mtime.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findOrgFiles } from '../shared/fileWalker';
import { DEFAULT_TODO_STATES, parseTodoKeywords } from '../shared/todoKeywords';
import { parseOrgLinkUri } from './scene';

export interface NoteHeading {
    file: string;
    /** 1-based */
    line: number;
    level: number;
    title: string;
    todo?: string;
    done?: boolean;
    priority?: string;
    tags: string[];
    id?: string;
    customId?: string;
    /** Titles of the headings above, outermost first */
    outline: string[];
}

/** What a shape's link points at, as the editor shows it. */
export interface LinkStatus {
    title?: string;
    todo?: string;
    done?: boolean;
    priority?: string;
    outline?: string;
    snippet?: string;
    file?: string;
    line?: number;
    broken?: string;
}

const DONE_DEFAULTS = new Set(['DONE', 'CANCELLED', 'CANCELED']);
const HEADING_RE = /^(\*+)\s+(.*)$/;
const SNIPPET_LINES = 8;

function expandHome(p: string): string {
    return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

/** Parse the headings of one org file. */
export function parseOrgHeadings(content: string, file: string): NoteHeading[] {
    const workflow = parseTodoKeywords(content);
    const states = new Set<string>([...DEFAULT_TODO_STATES, ...(workflow?.allStates ?? [])]);
    const doneStates = new Set<string>(workflow?.doneStates ?? DONE_DEFAULTS);

    const lines = content.split(/\r?\n/);
    const headings: NoteHeading[] = [];
    const stack: NoteHeading[] = [];
    let inBlock = false;

    for (let i = 0; i < lines.length; i++) {
        const text = lines[i];
        if (/^\s*#\+begin_/i.test(text)) inBlock = true;
        else if (/^\s*#\+end_/i.test(text)) inBlock = false;
        if (inBlock) continue;

        const m = HEADING_RE.exec(text);
        if (!m) continue;
        const level = m[1].length;
        let rest = m[2];

        let tags: string[] = [];
        const tagMatch = rest.match(/\s+:([\w@#%:-]+):\s*$/);
        if (tagMatch) {
            tags = tagMatch[1].split(':').filter(Boolean);
            rest = rest.slice(0, tagMatch.index);
        }
        let todo: string | undefined;
        const first = rest.split(/\s+/, 1)[0];
        if (states.has(first)) {
            todo = first;
            rest = rest.slice(first.length).trimStart();
        }
        let priority: string | undefined;
        const pri = rest.match(/^\[#([A-Z0-9])\]\s*/);
        if (pri) {
            priority = pri[1];
            rest = rest.slice(pri[0].length);
        }

        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        const heading: NoteHeading = {
            file,
            line: i + 1,
            level,
            title: rest.trim(),
            todo,
            done: todo ? doneStates.has(todo) : undefined,
            priority,
            tags,
            outline: stack.map(h => h.title),
        };

        // Property drawer right below (after an optional planning line)
        let inDrawer = false;
        for (let j = i + 1; j < Math.min(i + 80, lines.length); j++) {
            const t = lines[j];
            if (!inDrawer) {
                if (/^\s*:PROPERTIES:\s*$/i.test(t)) { inDrawer = true; continue; }
                if (j === i + 1 && /^\s*(SCHEDULED|DEADLINE|CLOSED):/.test(t)) continue;
                break;
            }
            if (/^\s*:END:\s*$/i.test(t)) break;
            const p = t.match(/^\s*:(ID|CUSTOM_ID):\s*(\S.*?)\s*$/i);
            if (p?.[1].toUpperCase() === 'ID') heading.id = p[2];
            if (p?.[1].toUpperCase() === 'CUSTOM_ID') heading.customId = p[2];
        }

        headings.push(heading);
        stack.push(heading);
    }
    return headings;
}

/** First lines of a heading's entry: planning and body, drawers left out. */
export function headingSnippet(content: string, line: number, max = SNIPPET_LINES): string {
    const lines = content.split(/\r?\n/);
    const out: string[] = [];
    let inDrawer = false;
    for (let i = line; i < lines.length && out.length < max; i++) {
        const t = lines[i];
        if (HEADING_RE.test(t)) break;
        if (/^\s*:[A-Z_]+:\s*$/i.test(t) && !/^\s*:END:\s*$/i.test(t)) { inDrawer = true; continue; }
        if (inDrawer) { if (/^\s*:END:\s*$/i.test(t)) inDrawer = false; continue; }
        if (!out.length && !t.trim()) continue;
        out.push(t);
    }
    while (out.length && !out[out.length - 1].trim()) out.pop();
    return out.join('\n');
}

interface CachedFile {
    mtimeMs: number;
    content: string;
    headings: NoteHeading[];
}

/** How many files to walk, and to keep, when scanning a project. */
const MAX_WALK_FILES = 20000;
const MAX_PROJECT_FILES = 5000;

/** Files sorted by modification time, newest first; unreadable ones last. */
export function newestFirst(files: string[]): string[] {
    const mtime = new Map<string, number>();
    for (const f of files) {
        try {
            mtime.set(f, fs.statSync(f).mtimeMs);
        } catch {
            mtime.set(f, -Infinity);
        }
    }
    return [...files].sort((a, b) => (mtime.get(b) as number) - (mtime.get(a) as number));
}

export class NoteIndex {
    private cache = new Map<string, CachedFile>();
    /** Unsaved text of open editors, by absolute path */
    overrides = new Map<string, string>();
    /** Files of the scanned projects, by project root */
    private projects = new Map<string, string[]>();

    /** Content and headings of a file, or undefined if it cannot be read. */
    read(file: string): CachedFile | undefined {
        const override = this.overrides.get(file);
        if (override !== undefined) {
            return { mtimeMs: -1, content: override, headings: parseOrgHeadings(override, file) };
        }
        let mtimeMs: number;
        try {
            mtimeMs = fs.statSync(file).mtimeMs;
        } catch {
            return undefined;
        }
        const cached = this.cache.get(file);
        if (cached && cached.mtimeMs === mtimeMs) return cached;
        let content: string;
        try {
            content = fs.readFileSync(file, 'utf8');
        } catch {
            return undefined;
        }
        const entry = { mtimeMs, content, headings: parseOrgHeadings(content, file) };
        this.cache.set(file, entry);
        return entry;
    }

    /**
     * Org files under a project root, most recently modified first (cached
     * until `forget`). A project with more than MAX_PROJECT_FILES keeps the
     * newest: a journal's old days are dropped, never today's.
     */
    async scanProject(root: string): Promise<string[]> {
        const known = this.projects.get(root);
        if (known) return known;
        const result = await findOrgFiles([root], { maxFiles: MAX_WALK_FILES });
        const files = newestFirst(result.files.filter(f => f.endsWith('.org'))).slice(0, MAX_PROJECT_FILES);
        this.projects.set(root, files);
        return files;
    }

    /** Every heading in a project's org files, newest file first. */
    async projectHeadings(root: string): Promise<NoteHeading[]> {
        const files = await this.scanProject(root);
        return files.flatMap(f => this.read(f)?.headings ?? []);
    }

    /**
     * Org files in the drawing's folder and the folder above it, where the
     * note that embeds a drawing (e.g. `diagrams/x.excalidraw.svg`) usually is.
     */
    async nearbyOrgFiles(drawing: string): Promise<string[]> {
        const dir = path.dirname(drawing);
        const out: string[] = [];
        for (const d of [dir, path.dirname(dir)]) {
            let names: string[];
            try {
                names = await fs.promises.readdir(d);
            } catch {
                continue;
            }
            for (const n of names.sort()) if (/\.org$/i.test(n)) out.push(path.join(d, n));
        }
        return out;
    }

    /** Which of `files` mention the drawing's file name, i.e. link to it. */
    filesLinkingTo(drawing: string, files: string[]): string[] {
        const name = path.basename(drawing);
        return files.filter(f => this.read(f)?.content.includes(name));
    }

    /** Drop cached file lists, e.g. after files are created or deleted. */
    forget(): void {
        this.projects.clear();
    }

    /** The heading with this :ID:, searching the given project roots. */
    async findId(id: string, roots: string[]): Promise<NoteHeading | undefined> {
        for (const root of roots) {
            for (const file of await this.scanProject(root)) {
                const h = this.read(file)?.headings.find(x => x.id === id);
                if (h) return h;
            }
        }
        return undefined;
    }
}

/**
 * Org link to `heading` for a drawing in `drawingDir`: `id:` when it has an
 * ID, else `file:<relative path>::#custom-id`, else `::*Title`.
 */
export function linkForHeading(heading: Pick<NoteHeading, 'file' | 'title' | 'id' | 'customId'>, drawingDir: string): string {
    if (heading.id) return `id:${heading.id}`;
    const rel = path.relative(drawingDir, heading.file).split(path.sep).join('/');
    if (heading.customId) return `file:${rel}::#${heading.customId}`;
    return `file:${rel}::*${heading.title}`;
}

export interface ResolveContext {
    index: NoteIndex;
    /** Project roots to search for id: links, nearest first */
    roots: string[];
    /** Project root for an nb: link's project name */
    notebookRoot?: (name: string) => string | undefined;
}

type Target = { heading: NoteHeading; content: string } | { file: string } | { broken: string } | undefined;

function headingFor(index: NoteIndex, file: string, search: string): Target {
    const entry = index.read(file);
    if (!entry) return { broken: `file not found: ${file}` };
    if (!search) return { file };
    if (/^\d+$/.test(search)) {
        const n = Number(search);
        const h = [...entry.headings].reverse().find(x => x.line <= n);
        return h ? { heading: h, content: entry.content } : { file };
    }
    if (/^c\d+$/.test(search)) return { file };
    if (search.startsWith('*')) {
        const title = search.slice(1).trim();
        const h = entry.headings.find(x => x.title === title);
        return h ? { heading: h, content: entry.content } : { broken: `no heading "${title}" in ${path.basename(file)}` };
    }
    if (search.startsWith('#')) {
        const id = search.slice(1).trim();
        const h = entry.headings.find(x => x.customId === id);
        return h ? { heading: h, content: entry.content } : { broken: `no CUSTOM_ID "${id}" in ${path.basename(file)}` };
    }
    // Text search: a heading whose title contains it, else just the file
    const h = entry.headings.find(x => x.title.includes(search));
    return h ? { heading: h, content: entry.content } : { file };
}

/** What an org link, written in a drawing at `drawingPath`, points at. */
async function resolveOrgTarget(orgLink: string, drawingPath: string, from: string | undefined, ctx: ResolveContext): Promise<Target> {
    let link = orgLink.trim();
    const bracket = link.match(/^\[\[(.+?)\](?:\[.*\])?\]$/s);
    if (bracket) link = bracket[1];
    const drawingDir = path.dirname(drawingPath);
    const fromFile = from ? path.resolve(drawingDir, expandHome(from)) : undefined;
    const baseDir = fromFile ? path.dirname(fromFile) : drawingDir;

    if (/^id:/i.test(link)) {
        const id = link.slice(3).trim();
        const h = await ctx.index.findId(id, ctx.roots);
        if (!h) return { broken: `no heading with ID ${id}` };
        return { heading: h, content: ctx.index.read(h.file)!.content };
    }
    if (/^nb:/i.test(link)) {
        const [project, file, ...rest] = link.slice(3).split('::');
        const root = ctx.notebookRoot?.(project);
        if (!root) return { broken: `unknown project ${project}` };
        return file ? headingFor(ctx.index, path.join(root, file), rest.join('::').trim()) : { file: root };
    }
    if (/^[*#]/.test(link)) {
        return fromFile ? headingFor(ctx.index, fromFile, link) : { broken: 'a *heading or #id link needs a from= file' };
    }
    const isFile = /^file:/i.test(link) || (!/^[a-z][\w+-]*:/i.test(link)
        && (link.includes('/') || link.includes('::') || /\.\w+$/.test(link)));
    if (!isFile) return undefined; // web, cite, doi, cmd...: nothing to show
    const [filePart, ...rest] = link.replace(/^file:/i, '').split('::');
    const file = path.resolve(baseDir, expandHome(filePart));
    if (!/\.org$/i.test(file)) return fs.existsSync(file) ? { file } : { broken: `file not found: ${file}` };
    return headingFor(ctx.index, file, rest.join('::').trim());
}

/** Status of one shape's link (an org-link URI or plain org link), or undefined for none. */
export async function linkStatus(href: string, drawingPath: string, ctx: ResolveContext): Promise<LinkStatus | undefined> {
    const org = parseOrgLinkUri(href);
    const link = org?.link ?? (/^(file:|id:|nb:|\*|#)/i.test(href) ? href : undefined);
    if (!link) return undefined;
    const target = await resolveOrgTarget(link, drawingPath, org?.from, ctx);
    if (!target) return undefined;
    if ('broken' in target) return { broken: target.broken };
    if (!('heading' in target)) return { title: path.basename(target.file), file: target.file };
    const { heading, content } = target;
    return {
        title: heading.title,
        todo: heading.todo,
        done: heading.done,
        priority: heading.priority,
        outline: heading.outline.join(' › ') || undefined,
        snippet: headingSnippet(content, heading.line) || undefined,
        file: heading.file,
        line: heading.line,
    };
}
