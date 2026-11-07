/**
 * What the database indexes, and how a file gets in.
 *
 * - Files in the indexed roots (scimax.db.include, the journal, and the projects
 *   and workspace folders when those settings are on) are scanned, watched and
 *   kept up to date.
 * - A file you save is indexed wherever it is; opening it is not enough. It
 *   stays until you remove it (Scimax: Remove Files Outside Indexed Folders).
 * - scimax.db.exclude keeps files out by every route, except a file listed by
 *   its exact path in scimax.db.include ("Always Index This File"): a file beats
 *   a folder. The built-in excludes (node_modules, VS Code's history, ...) always
 *   apply.
 * - A file that changes on disk outside the roots (a git pull, a build, another
 *   program) is only re-indexed if it is already in the database.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const expand = (p: string, home: string = os.homedir()): string =>
    p.startsWith('~') ? path.join(home, p.slice(1)) : p;

/** The entries of scimax.db.include that are single files (forced in), as absolute paths. */
export function forcedFiles(include: readonly string[] | undefined): string[] {
    const out: string[] = [];
    for (const entry of include ?? []) {
        if (!entry || entry.includes('*')) continue;
        const p = path.resolve(expand(entry));
        try {
            if (fs.statSync(p).isFile()) out.push(p);
        } catch {
            // not on this machine
        }
    }
    return out;
}

/** True when filePath is one of the roots (a file root) or inside one (a folder root). */
export function underRoots(filePath: string, roots: readonly string[]): boolean {
    const target = path.resolve(filePath);
    return roots.some(root => {
        const r = path.resolve(root);
        return target === r || target.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
    });
}

/**
 * How to write a path in a settings list: with ~ for the home directory, so the
 * entry also works on another machine with the same layout.
 */
export function settingsPath(filePath: string, home: string = os.homedir()): string {
    const p = path.resolve(filePath);
    return p === home || p.startsWith(home + path.sep) ? '~' + p.slice(home.length) : p;
}

/** True when a settings entry (absolute or ~) names exactly this file. */
export function samePath(entry: string, filePath: string): boolean {
    return !entry.includes('*') && path.resolve(expand(entry)) === path.resolve(filePath);
}
