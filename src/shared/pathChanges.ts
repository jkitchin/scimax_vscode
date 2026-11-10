/**
 * Files and folders that Scimax itself renamed, moved or deleted (dired, the
 * F12 f file menu). VS Code raises onDidRenameFiles / onDidDeleteFiles only for
 * the Explorer and workspace edits, and a watcher reports a deleted folder as
 * one path, so these commands announce what they did here; the database and
 * the search view listen.
 */
import * as path from 'path';

export interface PathMove {
    from: string;
    to: string;
}

export interface PathChanges {
    moved: PathMove[];
    deleted: string[];
}

type Listener = (changes: PathChanges) => void;
const listeners = new Set<Listener>();

/** Listen for paths that Scimax moved or deleted. */
export function onPathsChanged(listener: Listener): { dispose(): void } {
    listeners.add(listener);
    return { dispose: () => { listeners.delete(listener); } };
}

/** Announce paths that were moved or deleted (files or whole folders). */
export function notifyPathsChanged(changes: Partial<PathChanges>): void {
    const full: PathChanges = { moved: changes.moved ?? [], deleted: changes.deleted ?? [] };
    if (full.moved.length === 0 && full.deleted.length === 0) return;
    for (const listener of [...listeners]) {
        try {
            listener(full);
        } catch {
            // one listener failing must not stop the others
        }
    }
}

function within(p: string, root: string): string | undefined {
    const target = path.resolve(p);
    const r = path.resolve(root);
    if (target === r) return '';
    const prefix = r.endsWith(path.sep) ? r : r + path.sep;
    return target.startsWith(prefix) ? target.slice(prefix.length) : undefined;
}

/**
 * What the database must do after `changes`: the indexed paths to drop (those
 * at or under a moved or deleted path), and the paths to index — the new
 * locations of moved indexed files, plus moved files that `wanted` accepts
 * (e.g. renamed into an indexed folder, or to an indexed extension).
 */
export function indexUpdatesFor(
    indexed: readonly string[],
    changes: PathChanges,
    wanted: (p: string) => boolean = () => false,
): { remove: string[]; index: string[] } {
    const remove = new Set<string>();
    const index = new Set<string>();
    for (const file of indexed) {
        for (const gone of changes.deleted) {
            if (within(file, gone) !== undefined) remove.add(file);
        }
        for (const move of changes.moved) {
            const rest = within(file, move.from);
            if (rest === undefined) continue;
            remove.add(file);
            index.add(rest ? path.join(path.resolve(move.to), rest) : path.resolve(move.to));
        }
    }
    for (const move of changes.moved) {
        const to = path.resolve(move.to);
        if (!index.has(to) && wanted(to)) index.add(to);
    }
    for (const p of index) remove.delete(p);
    return { remove: [...remove].sort(), index: [...index].sort() };
}
