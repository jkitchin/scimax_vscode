/**
 * Marp command - build a Marp deck into one self-contained HTML file with the
 * presenter tools (pen, laser, notes, save with ink, live Python cells).
 *
 * Uses the same Marp engine, scripts and bundler as the extension's HTML
 * export (media/marpPresent, src/marp/presenterBundle.ts), and shares its
 * caches of KaTeX fonts and offline Pyodide files.
 */

import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { buildMarpArgs, marpErrorText } from '../../marp/marpExport';
import { frontMatterValue } from '../../marp/marpAuthoring';
import {
    addMediaScript, BundleReport, bundlePresenterDeck, offlineIssues, OfflinePlan, parseTimer,
    presenterAssets, presenterOffline, presenterRequested,
} from '../../marp/presenterBundle';
import { fetchFontCached, offlinePythonFiles } from '../../marp/presenterDownloads';
import { bundledThemeFiles } from '../../marp/bundledThemes';
import { findMarpCliConfig } from '../../marp/marpConfig';
import { scimaxGlobalStorageDir } from '../globalStorage';
import { parseJsonc, readVSCodeSettings } from '../settings';
import { appWindowCommand, openAppWindow, presentWindow, resolveAppBrowser, systemSearch } from '../../marp/appWindow';
import { pathToFileURL } from 'url';

interface CliConfig {
    dbPath: string;
    rootDir: string;
}

interface ParsedArgs {
    command: string;
    subcommand?: string;
    args: string[];
    flags: Record<string, string | boolean>;
    /** Arguments after `--`, passed on to Marp CLI. */
    passthrough?: string[];
}

/** Marp CLI major version run through npx, as in the extension. */
const NPX_PACKAGE = '@marp-team/marp-cli@4';

/** The extension's media/marpPresent folder, from out/cli/commands. */
const MEDIA_DIR = path.join(__dirname, '..', '..', '..', 'media', 'marpPresent');

/**
 * Scimax's Marp engine (out/marp/cliEngine.js), as in the extension's
 * exports: citations for every format, plus the presenter fences when
 * SCIMAX_MARP_PRESENTER is 1.
 */
const ENGINE = path.join(__dirname, '..', '..', 'marp', 'cliEngine.js');

/** The scimax.marp settings `scimax marp build` uses, read from VS Code's settings files. */
export interface MarpCliSettings {
    /** Theme CSS files (absolute paths); remote URLs are left out. */
    themes: string[];
    browserPath?: string;
    presentWindow: string;
    appBrowser: string;
}

/**
 * The nearest `.vscode/settings.json` at or above `dir`: the deck's
 * workspace, whose settings override the user's.
 */
export function findWorkspaceSettings(dir: string): { root: string; settings: Record<string, unknown> } | undefined {
    let current = path.resolve(dir);
    for (;;) {
        const file = path.join(current, '.vscode', 'settings.json');
        if (fs.existsSync(file)) {
            try {
                return { root: current, settings: parseJsonc(fs.readFileSync(file, 'utf8')) };
            } catch {
                return undefined;
            }
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return undefined;
        }
        current = parent;
    }
}

/**
 * The deck's Marp settings, like the extension's: workspace settings over
 * user settings, `scimax.marp.themes` falling back to `markdown.marp.themes`,
 * relative theme paths against the workspace folder (or the deck's folder).
 */
export function marpCliSettings(
    deckDir: string,
    user: Record<string, unknown>,
    workspace?: { root: string; settings: Record<string, unknown> },
): MarpCliSettings {
    const get = (key: string): unknown => workspace?.settings[key] !== undefined ? workspace.settings[key] : user[key];
    const str = (key: string): string => typeof get(key) === 'string' ? (get(key) as string).trim() : '';
    const list = Array.isArray(get('scimax.marp.themes')) ? get('scimax.marp.themes')
        : Array.isArray(get('markdown.marp.themes')) ? get('markdown.marp.themes') : [];
    const base = workspace?.root ?? deckDir;
    const themes = (list as unknown[])
        .filter((theme): theme is string => typeof theme === 'string' && !/^https?:\/\//i.test(theme))
        .map(theme => path.isAbsolute(theme) ? theme : path.join(base, theme));
    return {
        themes,
        browserPath: str('scimax.marp.browserPath') || undefined,
        presentWindow: str('scimax.marp.presentWindow') || 'tab',
        appBrowser: str('scimax.marp.appBrowser'),
    };
}

const USAGE = `Usage: scimax marp build <deck.md> [options] [-- marp options]

Build a Marp deck into one self-contained HTML file with presenter tools.

Options:
    -o, --output <file>   HTML to write (default: the deck with .html)
    --open                Open the result (an app window with window: app)
    --pdf                 Also write a PDF (plain Marp output)
    --plain               Plain Marp HTML, without presenter tools
    --json                Print the result as JSON

Anything after -- goes to Marp CLI, e.g. -- --theme-set theme/custom.css

Presenter tools are on unless the deck's front matter says presenter: false.
presenter: offline embeds Python so the cells run without a network, and
timer: 20 adds a 20-minute talk timer.`;

/**
 * True if the deck gets presenter tools: always from the CLI, unless its
 * front matter turns them off (`presenter: false`) or `plain` is given.
 */
export function deckWantsPresenter(markdown: string, plain: boolean): boolean {
    if (plain) {
        return false;
    }
    const value = frontMatterValue(markdown.split(/\r?\n/), 'presenter');
    return value === undefined || value.trim() === '' || presenterRequested(value);
}

/** An executable on the PATH, or undefined. */
function findOnPath(name: string): string | undefined {
    const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
        for (const ext of exts) {
            const candidate = path.join(dir, name + ext);
            if (dir && fs.existsSync(candidate)) {
                return candidate;
            }
        }
    }
    return undefined;
}

/** Marp CLI: `marp` on the PATH, else npx (which downloads it the first time). */
function marpCli(): { command: string; prefix: string[] } {
    const marp = findOnPath('marp');
    if (marp) {
        return { command: marp, prefix: [] };
    }
    const npx = findOnPath('npx');
    if (!npx) {
        throw new Error('Marp CLI not found. Install it (npm install -g @marp-team/marp-cli) or Node.js (for npx).');
    }
    return { command: npx, prefix: ['--yes', NPX_PACKAGE] };
}

/** Run Marp CLI from the deck's folder (so .marprc and relative paths apply). */
function runMarp(args: string[], cwd: string, quiet: boolean, env: NodeJS.ProcessEnv): Promise<void> {
    const cli = marpCli();
    return new Promise((resolve, reject) => {
        const child = spawn(cli.command, [...cli.prefix, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        const collect = (chunk: Buffer) => {
            output += chunk.toString();
            if (!quiet) {
                process.stderr.write(chunk);
            }
        };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        child.on('error', reject);
        child.on('close', code => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Marp CLI failed: ${marpErrorText(output) || `exit code ${code}`}`));
            }
        });
    });
}

/**
 * Open the built deck like Present: in an app window when the deck's
 * `window:` or `scimax.marp.presentWindow` says `app`, else (or when no
 * Chromium browser is found) in the default browser.
 */
async function openDeck(file: string, markdown: string, settings: MarpCliSettings, quiet: boolean): Promise<void> {
    if (presentWindow(markdown, settings.presentWindow) === 'app') {
        const browser = resolveAppBrowser(settings.appBrowser, systemSearch());
        if (browser) {
            try {
                await openAppWindow(appWindowCommand(browser, pathToFileURL(file).href, process.platform));
                return;
            } catch (error) {
                if (!quiet) console.error(`Could not open ${browser} (${error instanceof Error ? error.message : String(error)}); opening the default browser.`);
            }
        } else if (!quiet) {
            console.error(settings.appBrowser
                ? `scimax.marp.appBrowser: ${settings.appBrowser} was not found; opening the default browser.`
                : 'No Chrome, Edge, Chromium or Brave found for an app window; opening the default browser.');
        }
    }
    openFile(file);
}

/** Open a file in the default browser. */
function openFile(file: string): void {
    const [command, args] = process.platform === 'darwin' ? ['open', [file]]
        : process.platform === 'win32' ? ['explorer.exe', [file]]
            : ['xdg-open', [file]];
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}

export async function marpCommand(_config: CliConfig, args: ParsedArgs): Promise<void> {
    if (args.subcommand !== 'build' || !args.args[1]) {
        console.error(USAGE);
        process.exit(1);
    }
    const json = args.flags.json === true;
    const input = path.resolve(args.args[1]);
    if (!fs.existsSync(input)) {
        throw new Error(`File not found: ${input}`);
    }
    const outFlag = args.flags.output ?? args.flags.o;
    const output = path.resolve(typeof outFlag === 'string' ? outFlag : input.replace(/\.[^./\\]+$/, '') + '.html');
    const deckDir = path.dirname(input);
    const markdown = fs.readFileSync(input, 'utf8');
    const presenter = deckWantsPresenter(markdown, args.flags.plain === true);
    const extra = args.passthrough ?? [];
    // Scimax's own themes, such as `theme: scimax`, plus the `themeSet` of a
    // .marprc next to the deck: a --theme-set argument replaces the config's
    // themeSet in Marp CLI, so it has to be passed along here.
    const settings = marpCliSettings(deckDir, readVSCodeSettings(), findWorkspaceSettings(deckDir));
    const configured = new Set(settings.themes);
    const themeFiles = [
        ...bundledThemeFiles().filter(file => !configured.has(file)),
        ...settings.themes.filter(file => fs.existsSync(file)),
        ...(findMarpCliConfig(deckDir)?.themeFiles ?? []).filter(file => !configured.has(file)),
    ];
    const marpEnv = (withPresenter: boolean): NodeJS.ProcessEnv =>
        ({ ...process.env, SCIMAX_MARP_DECK: input, SCIMAX_MARP_PRESENTER: withPresenter ? '1' : '' });
    const say = (message: string) => {
        if (!json) {
            console.error(message);
        }
    };

    // Marp writes a scratch file next to the output, so a failed build leaves the old deck alone.
    const scratch = path.join(path.dirname(output), `.${randomBytes(8).toString('hex')}.html`);
    let report: BundleReport | undefined;
    let plan: OfflinePlan | undefined;
    let pythonError: string | undefined;
    try {
        await runMarp([...extra, ...buildMarpArgs(input, scratch, 'html', {
            allowLocalFiles: true,
            // Presenter decks may use HTML widgets (e.g. iframes).
            enableHtml: presenter,
            // Citations for every deck, and the presenter fences (cliEngine.ts)
            engine: ENGINE,
            themeFiles,
            browserPath: settings.browserPath,
        })], deckDir, json, marpEnv(presenter));

        if (presenter) {
            const html = fs.readFileSync(scratch, 'utf8');
            const lines = markdown.split(/\r?\n/);
            const cacheDir = scimaxGlobalStorageDir();
            let pyodide: Record<string, Buffer> | undefined;
            if (presenterOffline(frontMatterValue(lines, 'presenter')) && html.includes('<pre data-run=')) {
                try {
                    ({ files: pyodide, plan } = await offlinePythonFiles(
                        path.join(MEDIA_DIR, 'pycells.js'), cacheDir, markdown,
                        async (missing, fetchOne) => {
                            for (const [i, name] of missing.entries()) {
                                say(`Downloading Python for offline slides (once): ${name} (${i + 1} of ${missing.length})`);
                                await fetchOne(name);
                            }
                        }));
                } catch (error) {
                    pythonError = error instanceof Error ? error.message : String(error);
                    say(`Could not get Python for offline use (${pythonError}); the Python cells will need an internet connection.`);
                }
            }
            const bundled = await bundlePresenterDeck(html, {
                baseDir: deckDir,
                markdown,
                pyodide,
                timer: parseTimer(frontMatterValue(lines, 'timer')),
                assets: presenterAssets(MEDIA_DIR),
                fetchFont: url => fetchFontCached(cacheDir, url),
            });
            fs.writeFileSync(scratch, bundled.html, 'utf8');
            report = bundled.report;
        } else {
            // Movies and players stop on leaving their slide in every deck
            fs.writeFileSync(scratch, addMediaScript(fs.readFileSync(scratch, 'utf8'), presenterAssets(MEDIA_DIR).media), 'utf8');
        }
        fs.renameSync(scratch, output);
    } finally {
        fs.rmSync(scratch, { force: true });
    }

    let pdf: string | undefined;
    if (args.flags.pdf === true) {
        pdf = output.replace(/\.html?$/i, '') + '.pdf';
        await runMarp([...extra, ...buildMarpArgs(input, pdf, 'pdf', {
            allowLocalFiles: true, enableHtml: presenter, engine: ENGINE, themeFiles, browserPath: settings.browserPath,
        })], deckDir, json, marpEnv(false));
    }

    const issues = presenter ? offlineIssues({ markdown, report, plan, pythonError }) : [];
    if (json) {
        console.log(JSON.stringify({
            success: true,
            input_file: input,
            output,
            pdf,
            presenter,
            counts: report?.counts,
            missing: report?.missing ?? [],
            external: report?.external ?? [],
            issues: issues.map(issue => ({ line: issue.line + 1, message: issue.message })),
        }));
    } else {
        const size = (fs.statSync(output).size / 1e6).toFixed(1);
        console.log(`Wrote ${output} (${size} MB)${presenter ? ' with presenter tools: a annotate, l laser, n note, s save with ink' : ''}`);
        if (pdf) {
            console.log(`Wrote ${pdf}`);
        }
        if (report && Object.keys(report.counts).length > 0) {
            console.log(`Inlined: ${Object.entries(report.counts).map(([what, n]) => `${n} ${what}`).join(', ')}`);
        }
        for (const issue of issues) {
            console.log(`${path.basename(input)}:${issue.line + 1}: ${issue.message}`);
        }
    }
    if (args.flags.open === true) {
        await openDeck(output, markdown, settings, json);
    }
}
