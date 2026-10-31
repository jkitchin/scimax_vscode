/**
 * Marp themes that ship with Scimax (media/marp/themes), available to every
 * deck as if they were built in: the thumbnails, preview, exports and
 * `scimax marp build` all add them to Marp's theme set. No vscode import, so
 * the CLI can use it.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Names of the bundled themes (each file's `@theme` name). */
export const SCIMAX_THEMES = ['scimax'];

let themesDir: string | null | undefined;

/** media/marp/themes, from out/marp, out/cli/commands, src/marp or the bundled out/. */
function bundledThemesDir(): string | null {
    if (themesDir === undefined) {
        themesDir = [1, 2, 3]
            .map(up => path.join(__dirname, ...Array<string>(up).fill('..'), 'media', 'marp', 'themes'))
            .find(dir => fs.existsSync(path.join(dir, `${SCIMAX_THEMES[0]}.css`))) ?? null;
    }
    return themesDir;
}

/** Absolute paths of the bundled theme CSS files (none if they cannot be found). */
export function bundledThemeFiles(): string[] {
    const dir = bundledThemesDir();
    return dir ? SCIMAX_THEMES.map(name => path.join(dir, `${name}.css`)) : [];
}

/** True for one of the bundled theme files. */
export function isBundledThemeFile(file: string): boolean {
    return bundledThemeFiles().some(bundled => path.resolve(bundled) === path.resolve(file));
}
