/**
 * Marp CLI configuration files, so a deck renders in VS Code the way Marp CLI
 * renders it. A project can keep its theme and HTML settings in `.marprc.yml`
 * (or `.marprc`, `.marprc.yaml`, `.marprc.json`, or a `marp` key in
 * `package.json`) instead of in VS Code settings:
 *
 *     themeSet: ./theme
 *     html: true
 *
 * The nearest configuration file from the deck's folder upward is used, as
 * Marp CLI does. Paths in it are relative to its folder. JavaScript
 * configuration files (`marp.config.js`, `.marprc.js`) are not run.
 *
 * This module has no VS Code dependency so it can be unit tested directly.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

/** The parts of a Marp CLI configuration that affect rendering. */
export interface MarpCliConfig {
    /** The configuration file. */
    file: string;
    /** Theme CSS files, with folders expanded to the `.css` files in them. */
    themeFiles: string[];
    /** `html: true`. An allowlist object is not supported and reads as unset. */
    html?: boolean;
    /** `options.math`: `true` is Marp's default, MathJax. */
    math?: 'mathjax' | 'katex' | 'off';
}

/** Configuration file names in the order Marp CLI tries them within one folder. */
const CONFIG_FILES = ['package.json', '.marprc', '.marprc.json', '.marprc.yaml', '.marprc.yml'];

/** True if `file` is a file that can hold Marp CLI configuration. */
export function isMarpConfigFile(file: string): boolean {
    return CONFIG_FILES.includes(path.basename(file));
}

/** `.css` files in `dir` and its subfolders, sorted. */
function cssFilesIn(dir: string): string[] {
    const found: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            found.push(...cssFilesIn(full));
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.css')) {
            found.push(full);
        }
    }
    return found.sort();
}

/** Theme CSS files named by `themeSet`, relative to `dir`. Missing paths are skipped. */
function themeFiles(themeSet: unknown, dir: string): string[] {
    const entries = typeof themeSet === 'string' ? [themeSet] : Array.isArray(themeSet) ? themeSet : [];
    const files: string[] = [];
    for (const entry of entries) {
        if (typeof entry !== 'string' || entry.trim() === '') {
            continue;
        }
        const full = path.resolve(dir, entry);
        try {
            files.push(...(fs.statSync(full).isDirectory() ? cssFilesIn(full) : [full]));
        } catch {
            // Marp CLI reports a missing theme; the deck falls back to a built-in theme.
        }
    }
    return [...new Set(files)];
}

/**
 * The rendering settings in configuration file `file` with contents `text`,
 * or undefined if it has none (a `package.json` without a `marp` key, or a
 * file that does not parse).
 */
export function parseMarpCliConfig(file: string, text: string): MarpCliConfig | undefined {
    let data: unknown;
    try {
        data = path.basename(file) === 'package.json'
            ? (JSON.parse(text) as { marp?: unknown }).marp
            : yaml.load(text); // JSON is also YAML.
    } catch {
        return undefined;
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return undefined;
    }
    const config = data as { themeSet?: unknown; html?: unknown; options?: { math?: unknown } };
    const math = config.options?.math;
    return {
        file,
        themeFiles: themeFiles(config.themeSet, path.dirname(file)),
        html: typeof config.html === 'boolean' ? config.html : undefined,
        math: math === 'katex' || math === 'mathjax' ? math
            : math === true ? 'mathjax'
                : math === false ? 'off'
                    : undefined,
    };
}

/**
 * The configuration for a deck in `deckDir`: the first configuration file
 * found in `deckDir` or a folder above it, up to and including `stopDir`
 * (or the filesystem root).
 */
export function findMarpCliConfig(deckDir: string, stopDir?: string): MarpCliConfig | undefined {
    let dir = path.resolve(deckDir);
    const stop = stopDir === undefined ? undefined : path.resolve(stopDir);
    for (;;) {
        for (const name of CONFIG_FILES) {
            const file = path.join(dir, name);
            let text: string;
            try {
                text = fs.readFileSync(file, 'utf8');
            } catch {
                continue;
            }
            const config = parseMarpCliConfig(file, text);
            if (config) {
                return config;
            }
        }
        const parent = path.dirname(dir);
        if (dir === stop || parent === dir) {
            return undefined;
        }
        dir = parent;
    }
}
