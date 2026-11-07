/**
 * File types the scimax database indexes: the `scimax.db.fileExtensions`
 * setting, default `["org", "md"]`.
 *
 * Everything that decides whether a file belongs in the database goes through
 * here: the extension's directory walk, file watcher and save handler, and the
 * CLI's scan. DEFAULT_FILE_EXTENSIONS is the only copy of the default in code;
 * package.json declares the same default for the settings UI, and a test keeps
 * the two equal.
 */

import * as path from 'path';

/** Default for scimax.db.fileExtensions. */
export const DEFAULT_FILE_EXTENSIONS: readonly string[] = ['org', 'md'];

/**
 * Normalize a setting value to lowercase extensions with a leading dot,
 * de-duplicated. Accepts "org", ".org" or "ORG". Falls back to the default
 * when the value is missing or empty, so a blank setting never stops indexing.
 */
export function normalizeExtensions(extensions?: readonly string[] | null): string[] {
    const normalized = (extensions ?? [])
        .filter((e): e is string => typeof e === 'string')
        .map(e => e.trim().toLowerCase().replace(/^\.+/, ''))
        .filter(e => e.length > 0)
        .map(e => '.' + e);
    const unique = [...new Set(normalized)];
    return unique.length > 0 ? unique : DEFAULT_FILE_EXTENSIONS.map(e => '.' + e);
}

/** True when the file has one of the given extensions (setting values, normalized here). */
export function isIndexableFile(filePath: string, extensions?: readonly string[] | null): boolean {
    return normalizeExtensions(extensions).includes(path.extname(filePath).toLowerCase());
}

/** Glob for VS Code file watchers, e.g. `**\/*.{org,md}`. */
export function indexableFilesGlob(extensions?: readonly string[] | null): string {
    const names = normalizeExtensions(extensions).map(e => e.slice(1));
    return names.length === 1 ? `**/*.${names[0]}` : `**/*.{${names.join(',')}}`;
}
