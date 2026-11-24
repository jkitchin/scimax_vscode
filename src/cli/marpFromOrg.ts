/**
 * Org -> Marp deck for the CLI, as the extension's Export to Marp
 * (C-c C-e m s) does it: #+INCLUDE expanded, the scimax.export.marp.*
 * settings applied (workspace over user), and the deck written next to the
 * org file, or to #+EXPORT_FILE_NAME.
 */

import * as fs from 'fs';
import * as path from 'path';
import { exportToMarp, MarpExportOptions } from '../parser/orgExportMarp';
import { parseOrgFast } from '../parser/orgExportParser';
import { hasIncludes, processIncludes } from '../parser/orgInclude';

/** The `scimax.export.marp.*` settings the export reads. */
const OPTION_KEYS: Array<keyof MarpExportOptions> = [
    'theme', 'headingDivider', 'paginate', 'math', 'presenter', 'titleSlide',
    'titleSlideClass', 'fragments', 'nestBlocksUnderLists', 'languageMap', 'frontMatter',
];

/**
 * Marp export options from VS Code settings: workspace settings win over
 * user settings. Keys that are not set are left out, so the exporter's
 * defaults (and the org file's #+MARP_* keywords) apply.
 */
export function marpExportOptionsFromSettings(
    user: Record<string, unknown>,
    workspace?: Record<string, unknown>,
): Partial<MarpExportOptions> {
    const options: Partial<MarpExportOptions> = {};
    for (const key of OPTION_KEYS) {
        const name = `scimax.export.marp.${key}`;
        const value = workspace?.[name] !== undefined ? workspace[name] : user[name];
        if (value !== undefined && value !== null) {
            (options as Record<string, unknown>)[key] = value;
        }
    }
    return options;
}

/** Where the deck for `orgPath` goes: #+EXPORT_FILE_NAME (relative to the org file) or <name>.md. */
export function marpDeckPath(orgPath: string, content: string): string {
    const dir = path.dirname(orgPath);
    let name = parseOrgFast(content).keywords?.EXPORT_FILE_NAME?.trim();
    if (name) {
        if (!name.endsWith('.md')) name = `${name}.md`;
        return path.isAbsolute(name) ? name : path.join(dir, name);
    }
    return path.join(dir, `${path.basename(orgPath, path.extname(orgPath))}.md`);
}

/** The Marp Markdown for an org file's text. */
export function orgToMarp(orgPath: string, content: string, options: Partial<MarpExportOptions> = {}): string {
    const dir = path.dirname(orgPath);
    const expanded = hasIncludes(content)
        ? processIncludes(content, { basePath: dir, recursive: true, maxDepth: 10 })
        : content;
    return exportToMarp(expanded, { ...options, baseDir: dir });
}

/**
 * Export an org file to a Marp deck and return the deck's path. `output`
 * overrides where it goes. An existing deck there is replaced.
 */
export function writeMarpDeck(orgPath: string, options: Partial<MarpExportOptions>, output?: string): string {
    const content = fs.readFileSync(orgPath, 'utf8');
    const deck = output ? path.resolve(output) : marpDeckPath(orgPath, content);
    if (path.resolve(deck) === path.resolve(orgPath)) {
        throw new Error(`The Marp deck would overwrite the org file: ${orgPath}`);
    }
    fs.mkdirSync(path.dirname(deck), { recursive: true });
    fs.writeFileSync(deck, orgToMarp(orgPath, content, options), 'utf8');
    return deck;
}
