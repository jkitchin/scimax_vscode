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
    BundleReport, bundlePresenterDeck, offlineIssues, OfflinePlan, parseTimer,
    presenterAssets, presenterOffline, presenterRequested,
} from '../../marp/presenterBundle';
import { fetchFontCached, offlinePythonFiles } from '../../marp/presenterDownloads';
import { bundledThemeFiles } from '../../marp/bundledThemes';
import { scimaxGlobalStorageDir } from '../globalStorage';

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

const USAGE = `Usage: scimax marp build <deck.md> [options] [-- marp options]

Build a Marp deck into one self-contained HTML file with presenter tools.

Options:
    -o, --output <file>   HTML to write (default: the deck with .html)
    --open                Open the result in the default browser
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
function runMarp(args: string[], cwd: string, quiet: boolean): Promise<void> {
    const cli = marpCli();
    return new Promise((resolve, reject) => {
        const child = spawn(cli.command, [...cli.prefix, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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
            engine: presenter ? path.join(MEDIA_DIR, 'engine.cjs') : undefined,
            // Scimax's own themes, such as `theme: scimax`
            themeFiles: bundledThemeFiles(),
        })], deckDir, json);

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
        }
        fs.renameSync(scratch, output);
    } finally {
        fs.rmSync(scratch, { force: true });
    }

    let pdf: string | undefined;
    if (args.flags.pdf === true) {
        pdf = output.replace(/\.html?$/i, '') + '.pdf';
        await runMarp([...extra, ...buildMarpArgs(input, pdf, 'pdf', { allowLocalFiles: true, enableHtml: presenter })], deckDir, json);
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
        console.log(`Wrote ${output} (${size} MB)${presenter ? ' with presenter tools: a pen, l laser, n note, s save with ink' : ''}`);
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
        openFile(output);
    }
}
