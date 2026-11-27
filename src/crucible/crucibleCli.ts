/**
 * The crucible CLI (https://github.com/jkitchin/crucible) as a JSON API.
 *
 * Every read command of the CLI takes `--json`; this module runs it and
 * returns the parsed output. Crucible's database schema stays private to
 * crucible: scimax only uses the CLI's JSON, and reads the wiki's org files.
 *
 * This module has no VS Code dependency so it can be unit tested directly.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** An article as the CLI reports it. `path` is relative to the crucible root. */
export interface CrucibleArticle {
    path: string;
    title: string;
    article_type: string;
    status?: string;
    abstract?: string;
    /** Registry name of the crucible a `search --all` result came from. */
    _crucible?: string;
    /** `backlinks`: text around the link. */
    context?: string;
    /** `related`: why the article is related. */
    reasons?: string[];
}

export interface CrucibleConcept {
    name: string;
    article_count: number;
}

export interface RegistryEntry {
    name: string;
    path: string;
    description: string;
    /** Path of the crucible's database, or null when the entry is stale. */
    db: string | null;
}

/** An issue from `crucible lint --json`. */
export interface CrucibleLintIssue {
    type: string;
    severity: 'error' | 'warning' | 'info';
    message: string;
    /** File the issue concerns, relative to the crucible root (absent for crucible-wide issues). */
    path?: string;
    /** `broken_link`: the link target as written. */
    link?: string;
    /** `missing_citation`: the cite key. */
    key?: string;
}

export interface CrucibleHistory {
    derived_from: CrucibleArticle[];
    derivatives: CrucibleArticle[];
}

export type SearchMode = 'auto' | 'fts' | 'semantic' | 'hybrid';

/** Name of the per-project crucible directory. */
export const CRUCIBLE_DIR = '.crucible';

/** A failed CLI run, with a message fit to show the user. */
export class CrucibleCliError extends Error {
    constructor(message: string, readonly notFound = false) {
        super(message);
        this.name = 'CrucibleCliError';
    }
}

export interface CliOptions {
    /** The crucible executable. */
    command: string;
    /** Directory to run in: a crucible root for project commands. */
    cwd: string;
    timeoutMs?: number;
}

/** Run `crucible <args> --json` and parse its output. */
export function runCrucibleJson<T>(args: string[], options: CliOptions): Promise<T> {
    return new Promise((resolve, reject) => {
        execFile(options.command, [...args, '--json'], {
            cwd: options.cwd,
            timeout: options.timeoutMs ?? 60_000,
            // `suggest` lists every missing link; large wikis print megabytes.
            maxBuffer: 64 * 1024 * 1024,
        }, (error, stdout, stderr) => {
            if (error) {
                const code = (error as NodeJS.ErrnoException).code;
                if (code === 'ENOENT') {
                    reject(new CrucibleCliError(`The crucible command was not found: ${options.command}`, true));
                    return;
                }
                const detail = String(stderr).trim().split('\n').pop() || error.message;
                reject(new CrucibleCliError(`crucible ${args[0]}: ${detail.replace(/^Error:\s*/, '')}`));
                return;
            }
            try {
                resolve(JSON.parse(String(stdout)) as T);
            } catch {
                reject(new CrucibleCliError(
                    `crucible ${args[0]} did not print JSON. Crucible may be too old for --json; update it.`));
            }
        });
    });
}

/** Run a crucible command for its effect (e.g. `sync`), returning its output. */
export function runCrucible(args: string[], options: CliOptions): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(options.command, args, {
            cwd: options.cwd,
            timeout: options.timeoutMs ?? 120_000,
            maxBuffer: 16 * 1024 * 1024,
        }, (error, stdout, stderr) => {
            if (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                    reject(new CrucibleCliError(`The crucible command was not found: ${options.command}`, true));
                    return;
                }
                const detail = String(stderr).trim().split('\n').pop() || error.message;
                reject(new CrucibleCliError(`crucible ${args[0]}: ${detail.replace(/^Error:\s*/, '')}`));
                return;
            }
            resolve(String(stdout).trim());
        });
    });
}

/**
 * The crucible root holding `file`: the nearest ancestor with
 * `.crucible/wiki/`. As in crucible, the home directory is never a root,
 * since `~/.crucible/` is the global registry.
 */
export function findCrucibleRoot(file: string, home: string = os.homedir()): string | undefined {
    const registryDir = path.resolve(home, CRUCIBLE_DIR);
    let dir = path.resolve(file);
    for (;;) {
        const candidate = path.join(dir, CRUCIBLE_DIR);
        if (candidate !== registryDir && isDirectory(path.join(candidate, 'wiki'))) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return undefined;
        }
        dir = parent;
    }
}

function isDirectory(p: string): boolean {
    try {
        return fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
}

/** Wiki directory, bibliography and index of a crucible root. */
export function cruciblePaths(root: string): { wiki: string; bibliography: string; index: string } {
    const dir = path.join(root, CRUCIBLE_DIR);
    return {
        wiki: path.join(dir, 'wiki'),
        bibliography: path.join(dir, 'references.bib'),
        index: path.join(dir, 'wiki', 'index.org'),
    };
}

/** Article directories of a wiki, in display order, with their labels. */
export const ARTICLE_TYPES: { dir: string; label: string }[] = [
    { dir: 'concepts', label: 'Concept articles' },
    { dir: 'summaries', label: 'Summaries' },
    { dir: 'comparisons', label: 'Comparisons' },
    { dir: 'methods', label: 'Methods' },
];

export interface WikiArticle {
    /** Absolute path of the org file. */
    file: string;
    title: string;
}

/** The org articles in one wiki directory, sorted by title. */
export function listWikiArticles(root: string, typeDir: string): WikiArticle[] {
    const dir = path.join(cruciblePaths(root).wiki, typeDir);
    let names: string[];
    try {
        names = fs.readdirSync(dir);
    } catch {
        return [];
    }
    return names
        .filter(name => name.endsWith('.org'))
        .map(name => {
            const file = path.join(dir, name);
            return { file, title: orgTitle(file) ?? name.replace(/\.org$/, '') };
        })
        .sort((a, b) => a.title.localeCompare(b.title));
}

/** The `#+TITLE:` of an org file, read from its first lines. */
export function orgTitle(file: string): string | undefined {
    let head: string;
    try {
        const fd = fs.openSync(file, 'r');
        try {
            const buffer = Buffer.alloc(4096);
            head = buffer.toString('utf8', 0, fs.readSync(fd, buffer, 0, buffer.length, 0));
        } finally {
            fs.closeSync(fd);
        }
    } catch {
        return undefined;
    }
    const match = /^#\+TITLE:[ \t]*(.+?)[ \t]*$/im.exec(head);
    return match ? match[1] : undefined;
}

/** Where in a file's text a lint issue belongs: [line, start column, end column]. */
export function lintIssueRange(issue: CrucibleLintIssue, text: string): [number, number, number] {
    const needle = issue.link !== undefined ? `[[file:${issue.link}`
        : issue.key !== undefined ? issue.key
        : undefined;
    if (needle) {
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const col = issue.key !== undefined ? citeKeyColumn(lines[i], issue.key) : lines[i].indexOf(needle);
            if (col >= 0) {
                return [i, col, col + needle.length];
            }
        }
    }
    return [0, 0, 0];
}

/** Column of `key` as a whole cite key on `line` (not inside a longer key), or -1. */
function citeKeyColumn(line: string, key: string): number {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(?<=[:,;\\s])${escaped}(?![\\w-])`).exec(line);
    return match ? match.index : -1;
}

// =============================================================================
// Ingest and distill
// =============================================================================

/** A source from `crucible undigested --json`. `path` is relative to the crucible root. */
export interface CrucibleSource {
    id: number;
    path: string;
    title: string;
    source_type: string;
    /** JSON text holding `cite_key` among other fields. */
    metadata?: string | null;
}

/** The cite key of a source, from its metadata. */
export function sourceCiteKey(source: CrucibleSource): string | undefined {
    if (!source.metadata) {
        return undefined;
    }
    try {
        const key = (JSON.parse(source.metadata) as { cite_key?: unknown }).cite_key;
        return typeof key === 'string' && key ? key : undefined;
    } catch {
        return undefined;
    }
}

/** What `crucible ingest` reported. */
export interface IngestResult {
    title?: string;
    citeKey?: string;
    /** Stored copy, relative to the crucible root. */
    stored?: string;
    /** The same content was ingested before; nothing changed. */
    alreadyIngested: boolean;
}

/** Read the result of `crucible ingest` from its (text) output. */
export function parseIngestOutput(output: string): IngestResult {
    const field = (name: string) => new RegExp(`^\\s*${name}:[ \\t]*(.+?)[ \\t]*$`, 'm').exec(output)?.[1];
    const header = /^(Ingested|Already ingested[^:]*):[ \t]*(.+?)[ \t]*$/m.exec(output);
    return {
        title: header?.[2],
        citeKey: field('Cite key'),
        stored: field('Stored'),
        alreadyIngested: header ? header[1] !== 'Ingested' : false,
    };
}

/**
 * The prompt Scimax prefills in Claude Code to distill a source: the
 * crucible, the source and its cite key, and the plan-then-write process,
 * with an optional focus from the user.
 */
export function distillPrompt(root: string, source: { path: string; title: string; citeKey?: string }, focus?: string): string {
    const key = source.citeKey ? ` (cite key ${source.citeKey})` : '';
    const focusText = focus?.trim() ? ` Focus on: ${focus.trim()}.` : '';
    return `Distill the source "${source.title}"${key} in the crucible at ${root} into wiki articles. `
        + `The source is ${path.join(root, source.path)}. Use the crucible skill and run crucible commands from ${root}. `
        + 'First read the source and the related existing articles, and show me a plan (summary article, '
        + 'new and updated concept articles, cross-links) before writing anything. '
        + `After I approve it, write the articles with SOURCE_KEYS set${source.citeKey ? ` to ${source.citeKey}` : ''}, `
        + `cite with citep:, then run crucible sync and crucible lint.${focusText}`;
}

// =============================================================================
// The knowledge graph (`crucible graph --json`)
// =============================================================================

export interface CrucibleGraphNode {
    /** `a<id>` article, `c<id>` concept, `s<id>` source. */
    id: string;
    type: 'article' | 'concept' | 'source';
    /** Articles: concept, summary, comparison or method. */
    kind?: string;
    title?: string;
    /** Concepts. */
    name?: string;
    article_count?: number;
    /** Articles and sources, relative to the crucible root. */
    path?: string;
    status?: string;
    source_type?: string;
    /** Sources: cite key. */
    key?: string | null;
}

export interface CrucibleGraphEdge {
    source: string;
    target: string;
    type: 'link' | 'concept' | 'derivation' | 'source';
}

export interface CrucibleGraph {
    /** Absolute crucible root. */
    root: string;
    nodes: CrucibleGraphNode[];
    edges: CrucibleGraphEdge[];
}

/** The id of the article node at `file` (absolute), if the graph has one. */
export function graphNodeForFile(graph: CrucibleGraph, file: string): string | undefined {
    const rel = path.relative(graph.root, path.resolve(file));
    const normalized = rel.split(path.sep).join('/');
    return graph.nodes.find(n => n.type === 'article' && n.path === normalized)?.id;
}

/**
 * The prompt Scimax prefills in Claude Code to answer `question` from the
 * crucible at `root`: search the wiki, read the articles, answer with links
 * to them, and say what the wiki does not cover. The wiki is not edited.
 */
export function askPrompt(root: string, question: string): string {
    return `Answer this question from the crucible knowledge base at ${root}: ${question.trim()}\n\n`
        + `Use the crucible skill and run crucible commands (search, concepts, related) from ${root} `
        + 'to find the relevant wiki articles, and read them. Base the answer on what the articles say, '
        + 'link each article you use as an org file link, and give the cite keys (citep:) of the sources behind '
        + 'its claims. Say plainly what the wiki does not cover. Do not edit the wiki.';
}
