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
