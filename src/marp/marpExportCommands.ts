/**
 * Export Marp decks: PDF, PowerPoint (image or editable), HTML, PNG images and
 * presenter notes through Marp CLI, and editable PowerPoint through Pandoc.
 *
 * Marp CLI is taken from `scimax.marp.cliPath`, then `marp` on the PATH, then
 * `npx @marp-team/marp-cli` (after asking once, since npx downloads it).
 */

import { spawn } from 'child_process';
import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import * as vscode from 'vscode';
import { checkPandoc } from '../markdown/markdownExport';
import { isMarpText, slideStarts } from './slideRenderer';
import { currentMarpDeck } from './currentDeck';
import { marpHtmlEnabled, marpThemeUris } from './marpSettings';
import {
    buildMarpArgs, buildPandocPptxArgs, describeMarpFailure, localFilesWereBlocked,
    liveReloadVersionScript, MARP_FORMATS, MarpExportFormat, marpOutputPath, marpToPandocMarkdown, prepareSlideshowHtml,
} from './marpExport';
import { parseDeck } from './slideModel';
import { frontMatterValue } from './marpAuthoring';
import {
    BundleReport, bundlePresenterDeck, inlineDeck, OfflineCheck, offlineIssues, OfflinePlan, planOfflinePython,
    presenterAssets, presenterOffline, presenterRequested, pyodideBaseUrl, PyodideLock,
} from './presenterBundle';

/** Marp CLI major version run through npx. */
const NPX_PACKAGE = '@marp-team/marp-cli@4';
const NPX_CONSENT_KEY = 'scimax.marp.npxConsent';
const EXPORT_TIMEOUT_MS = 5 * 60 * 1000;
const GOOGLE_DRIVE_URL = 'https://drive.google.com/drive/my-drive';
const LIBREOFFICE_URL = 'https://www.libreoffice.org/download/';
const MARP_CLI_URL = 'https://github.com/marp-team/marp-cli#install';

let output: vscode.OutputChannel | undefined;

function log(): vscode.OutputChannel {
    output ??= vscode.window.createOutputChannel('Scimax Marp Export');
    return output;
}

interface Command {
    command: string;
    prefix: string[];
}

interface RunResult {
    code: number | null;
    output: string;
    cancelled: boolean;
}

/** An executable on the PATH, or undefined. */
function findOnPath(name: string): string | undefined {
    const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
        for (const ext of exts) {
            const candidate = path.join(dir, name + ext);
            try {
                fs.accessSync(candidate, fs.constants.X_OK);
                if (fs.statSync(candidate).isFile()) {
                    return candidate;
                }
            } catch {
                // Not here.
            }
        }
    }
    return undefined;
}

/**
 * Windows runs .cmd/.bat files only through cmd.exe. Arguments are quoted,
 * and characters cmd.exe would interpret are refused rather than escaped.
 */
function windowsCommand(command: string, args: string[]): { command: string; args: string[] } {
    if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(command)) {
        return { command, args };
    }
    const quoted = [command, ...args].map(arg => {
        if (/["%!^&|<>\r\n]/.test(arg)) {
            throw new Error(`Cannot pass "${arg}" to ${path.basename(command)}: it contains a character cmd.exe interprets.`);
        }
        return `"${arg}"`;
    });
    return { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${quoted.join(' ')}"`] };
}

/** Whether Marp CLI will find LibreOffice (the same places it looks). */
function libreOfficeAvailable(document: vscode.TextDocument): boolean {
    const configured = vscode.workspace.getConfiguration('scimax.marp', document.uri).get<string>('libreOfficePath', '').trim();
    const candidates = [configured, process.env.SOFFICE_PATH ?? ''];
    if (process.platform === 'darwin') {
        candidates.push('/Applications/LibreOffice.app/Contents/MacOS/soffice');
    } else if (process.platform === 'win32') {
        for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
            if (root) {
                candidates.push(path.join(root, 'LibreOffice', 'program', 'soffice.exe'));
            }
        }
    }
    return candidates.some(c => c !== '' && fs.existsSync(c)) || findOnPath('soffice') !== undefined;
}

/**
 * Google Slides imports editable PowerPoint best. Use Marp's (keeps the
 * theme) when LibreOffice is there, else Pandoc's, else the image PowerPoint.
 */
async function exportForGoogleSlides(context: vscode.ExtensionContext): Promise<void> {
    const document = await activeDeck();
    if (!document) {
        return;
    }
    if (libreOfficeAvailable(document)) {
        await exportWithMarp(context, 'googleSlides');
    } else if (checkPandoc().available) {
        await exportWithPandoc(true);
    } else {
        const choice = await vscode.window.showWarningMessage(
            'An editable export needs LibreOffice or Pandoc. Export PowerPoint with each slide as a picture instead? '
            + 'Google Slides can show it, but not edit the text.',
            'Export Image PowerPoint'
        );
        if (choice) {
            await exportWithMarp(context, 'pptx', true);
        }
    }
}

async function resolveMarpCli(context: vscode.ExtensionContext): Promise<Command | undefined> {
    const configured = vscode.workspace.getConfiguration('scimax.marp').get<string>('cliPath', '').trim();
    if (configured) {
        return { command: configured, prefix: [] };
    }
    const marp = findOnPath('marp');
    if (marp) {
        return { command: marp, prefix: [] };
    }
    const npx = findOnPath('npx');
    if (!npx) {
        const choice = await vscode.window.showErrorMessage(
            'Marp export needs Marp CLI. Install it (npm install -g @marp-team/marp-cli) or Node.js, '
            + 'or set scimax.marp.cliPath.',
            'How to Install'
        );
        if (choice) {
            await vscode.env.openExternal(vscode.Uri.parse(MARP_CLI_URL));
        }
        return undefined;
    }
    if (!context.globalState.get<boolean>(NPX_CONSENT_KEY)) {
        const choice = await vscode.window.showInformationMessage(
            'Marp CLI is not installed. Scimax can run it with npx, which downloads '
            + `${NPX_PACKAGE} from npm the first time (this takes a little while).`,
            { modal: true },
            'Use npx',
            'How to Install'
        );
        if (choice === 'How to Install') {
            await vscode.env.openExternal(vscode.Uri.parse(MARP_CLI_URL));
        }
        if (choice !== 'Use npx') {
            return undefined;
        }
        await context.globalState.update(NPX_CONSENT_KEY, true);
    }
    return { command: npx, prefix: ['--yes', NPX_PACKAGE] };
}

/** Run a process, logging its output, until it exits, times out or is cancelled. */
function run(
    command: string,
    args: string[],
    options: { cwd: string; env?: NodeJS.ProcessEnv; input?: string },
    token: vscode.CancellationToken
): Promise<RunResult> {
    const channel = log();
    const resolved = windowsCommand(command, args);
    channel.appendLine(`$ ${[command, ...args].join(' ')}`);

    return new Promise((resolve, reject) => {
        const child = spawn(resolved.command, resolved.args, {
            cwd: options.cwd,
            env: options.env ?? process.env,
            windowsVerbatimArguments: resolved.command !== command,
        });
        let text = '';
        let cancelled = false;
        const collect = (chunk: Buffer) => {
            const s = chunk.toString();
            text += s;
            channel.append(s);
        };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);

        const stop = () => {
            cancelled = true;
            child.kill();
        };
        const cancel = token.onCancellationRequested(stop);
        const timer = setTimeout(() => {
            channel.appendLine(`Timed out after ${EXPORT_TIMEOUT_MS / 1000} s.`);
            stop();
        }, EXPORT_TIMEOUT_MS);

        child.on('error', error => {
            clearTimeout(timer);
            cancel.dispose();
            reject(error);
        });
        child.on('close', code => {
            clearTimeout(timer);
            cancel.dispose();
            channel.appendLine(`(exit code ${code})`);
            resolve({ code, output: text, cancelled });
        });

        if (options.input !== undefined) {
            child.stdin.end(options.input);
        } else {
            child.stdin.end();
        }
    });
}

/**
 * The Marp deck to export: the active editor, else a visible Marp editor,
 * else the deck the slide thumbnails show (when run from their menu).
 */
async function activeDeck(): Promise<vscode.TextDocument | undefined> {
    const isDeck = (d: vscode.TextDocument) => d.languageId === 'markdown' && isMarpText(d.getText());
    const document = [vscode.window.activeTextEditor?.document, ...vscode.window.visibleTextEditors.map(e => e.document), currentMarpDeck()]
        .find((d): d is vscode.TextDocument => d !== undefined && isDeck(d));
    if (!document) {
        vscode.window.showWarningMessage('Open a Marp deck (a Markdown file with marp: true in its front matter) to export it.');
        return undefined;
    }
    if (document.isUntitled) {
        vscode.window.showWarningMessage('Save the deck before exporting it.');
        return undefined;
    }
    // Marp CLI reads the file from disk.
    if (document.isDirty && !(await document.save())) {
        return undefined;
    }
    return document;
}

/**
 * True if the deck asks for presenter tools (`presenter: true` in its front
 * matter) and they may run here. They inline local files and run the deck's
 * Python in the browser, so an untrusted workspace gets the plain slideshow.
 */
function presenterEnabled(document: vscode.TextDocument): boolean {
    if (!presenterRequested(frontMatterValue(document.getText().split(/\r?\n/), 'presenter'))) {
        return false;
    }
    if (!vscode.workspace.isTrusted) {
        vscode.window.showWarningMessage('Presenter tools are off because this workspace is not trusted; using the plain slideshow.');
        return false;
    }
    return true;
}

/** Download a KaTeX font once, caching it in the extension's global storage. */
async function fetchFontCached(context: vscode.ExtensionContext, url: string): Promise<Buffer> {
    const dir = path.join(context.globalStorageUri.fsPath, 'marp-present-fonts');
    const file = path.join(dir, path.basename(new URL(url).pathname));
    try {
        return await fs.promises.readFile(file);
    } catch {
        // Not cached yet.
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) {
        throw new Error(`Could not download ${url}: HTTP ${response.status}`);
    }
    const data = Buffer.from(await response.arrayBuffer());
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(file, data);
    return data;
}

/** Download a file, failing on an HTTP error. */
async function download(url: string, timeoutMs: number): Promise<Buffer> {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
        throw new Error(`Could not download ${url}: HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
}

/**
 * The Pyodide files an offline deck (`presenter: offline`) embeds: Pyodide
 * itself and the packages its run cells import. They are downloaded once
 * into the extension's global storage (wheels checked against the lock
 * file's sha256), so later builds work without a network.
 */
export async function offlinePythonFiles(
    context: vscode.ExtensionContext,
    markdown: string
): Promise<{ files: Record<string, Buffer>; plan: OfflinePlan }> {
    const pycells = await fs.promises.readFile(context.asAbsolutePath(path.join('media', 'marpPresent', 'pycells.js')), 'utf8');
    const base = pyodideBaseUrl(pycells);
    const version = base.match(/\/(v[^/]+)\//)?.[1] ?? 'pyodide';
    const dir = path.join(context.globalStorageUri.fsPath, 'pyodide', version);
    await fs.promises.mkdir(dir, { recursive: true });

    const cached = async (name: string, sha256?: string): Promise<Buffer | undefined> => {
        try {
            const data = await fs.promises.readFile(path.join(dir, name));
            if (!sha256 || createHash('sha256').update(data).digest('hex') === sha256) {
                return data;
            }
        } catch {
            // Not cached yet.
        }
        return undefined;
    };
    const save = async (name: string, data: Buffer): Promise<void> => {
        const tmp = path.join(dir, `.${name}.${randomBytes(8).toString('hex')}`);
        await fs.promises.writeFile(tmp, data);
        await fs.promises.rename(tmp, path.join(dir, name));
    };

    let lockData = await cached('pyodide-lock.json');
    if (!lockData) {
        lockData = await download(base + 'pyodide-lock.json', 60000);
        await save('pyodide-lock.json', lockData);
    }
    const lock = JSON.parse(lockData.toString('utf8')) as PyodideLock;
    const plan = planOfflinePython(markdown, lock);
    const sha = new Map(plan.packages.map(name => [lock.packages[name].file_name, lock.packages[name].sha256]));

    const files: Record<string, Buffer> = {};
    const missing: string[] = [];
    for (const name of plan.files) {
        const data = await cached(name, sha.get(name));
        if (data) {
            files[name] = data;
        } else {
            missing.push(name);
        }
    }
    if (missing.length > 0) {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Downloading Python for offline slides (once)',
            cancellable: false,
        }, async progress => {
            for (const [i, name] of missing.entries()) {
                progress.report({ message: `${name} (${i + 1} of ${missing.length})`, increment: 100 / missing.length });
                const data = await download(base + name, 300000);
                const expected = sha.get(name);
                if (expected && createHash('sha256').update(data).digest('hex') !== expected) {
                    throw new Error(`${name} does not match its checksum in pyodide-lock.json`);
                }
                await save(name, data);
                files[name] = data;
            }
        });
    }

    const size = Object.values(files).reduce((sum, data) => sum + data.length, 0);
    log().appendLine(`Offline Python: Pyodide ${version} with ${plan.packages.join(', ')} (${(size / 1e6).toFixed(1)} MB before encoding)`);
    if (plan.other.length > 0) {
        log().appendLine(`  imports that are not Pyodide packages (the standard library, or downloaded from PyPI when online): ${plan.other.join(', ')}`);
    }
    if (plan.pip) {
        log().appendLine('  %pip install needs a network connection; those cells will not work offline');
    }
    return { files, plan };
}

/** What adding the presenter tools found, for the offline check. */
interface PresenterBuild {
    report: BundleReport;
    plan?: OfflinePlan;
    pythonError?: string;
}

/**
 * Turn the Marp HTML at `htmlPath` into a self-contained deck with the
 * presenter tools (pen, laser, notes, save with ink, live Python cells).
 * Returns undefined (after reporting why) if it failed. `quiet` leaves out
 * the warning when offline Python is unavailable (it is still a problem in
 * the Problems panel).
 */
async function addPresenterTools(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
    htmlPath: string,
    quiet = false
): Promise<PresenterBuild | undefined> {
    try {
        const html = await fs.promises.readFile(htmlPath, 'utf8');
        const markdown = document.getText();
        let pyodide: Record<string, Buffer> | undefined;
        let plan: OfflinePlan | undefined;
        let pythonError: string | undefined;
        if (presenterOffline(frontMatterValue(markdown.split(/\r?\n/), 'presenter')) && html.includes('<pre data-run=')) {
            try {
                ({ files: pyodide, plan } = await offlinePythonFiles(context, markdown));
            } catch (error) {
                pythonError = error instanceof Error ? error.message : String(error);
                log().appendLine(`Offline Python unavailable: ${pythonError}`);
                if (!quiet) {
                    vscode.window.showWarningMessage(`Could not get Python for offline use (${pythonError}); the Python cells will need an internet connection.`);
                }
            }
        }
        const { html: bundled, report } = await bundlePresenterDeck(html, {
            baseDir: path.dirname(document.uri.fsPath),
            markdown,
            pyodide,
            assets: presenterAssets(context.asAbsolutePath(path.join('media', 'marpPresent'))),
            fetchFont: url => fetchFontCached(context, url),
        });
        await fs.promises.writeFile(htmlPath, bundled, 'utf8');
        const counts = Object.entries(report.counts).map(([what, n]) => `${n} ${what}`).join(', ');
        log().appendLine(`Presenter tools added to ${path.basename(htmlPath)}: ${counts}`);
        for (const missing of report.missing) {
            log().appendLine(`  not found: ${missing}`);
        }
        if (report.external.length > 0) {
            log().appendLine(`  still loaded from the web:\n    ${report.external.slice(0, 20).join('\n    ')}`);
        }
        return { report, plan, pythonError };
    } catch (error) {
        vscode.window.showErrorMessage(`Could not add presenter tools: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
}

// =============================================================================
// Offline check
// =============================================================================

let offlineDiagnostics: vscode.DiagnosticCollection | undefined;

/**
 * Show what in the deck needs a network (or is missing) in the Problems
 * panel, and return how many problems there are.
 */
function showOfflineIssues(document: vscode.TextDocument, check: OfflineCheck): number {
    offlineDiagnostics ??= vscode.languages.createDiagnosticCollection('scimax-marp-offline');
    const issues = offlineIssues(check);
    offlineDiagnostics.set(document.uri, issues.map(issue => {
        const line = Math.min(issue.line, document.lineCount - 1);
        const diagnostic = new vscode.Diagnostic(document.lineAt(line).range, issue.message, vscode.DiagnosticSeverity.Warning);
        diagnostic.source = 'Marp offline';
        return diagnostic;
    }));
    return issues.length;
}

/** Point to the Problems panel when an offline deck has problems. */
async function announceOfflineIssues(document: vscode.TextDocument, count: number): Promise<void> {
    if (count === 0) {
        return;
    }
    const choice = await vscode.window.showWarningMessage(
        `${count} ${count === 1 ? 'thing' : 'things'} in ${path.basename(document.fileName)} will not work without an internet connection.`,
        'Show Problems'
    );
    if (choice) {
        await vscode.commands.executeCommand('workbench.actions.view.problems');
    }
}

/**
 * Build the deck as it would be presented and list everything that needs a
 * network connection (Python packages, %pip, web fonts and images) or is
 * missing, in the Problems panel.
 */
async function checkOffline(context: vscode.ExtensionContext): Promise<void> {
    const document = await activeDeck();
    if (!document) {
        return;
    }
    const presenter = presenterEnabled(document);
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scimax-marp-check-'));
    try {
        const htmlPath = path.join(dir, `${path.parse(document.uri.fsPath).name}.html`);
        if (!(await convertWithMarp(context, document, 'html', htmlPath, `Checking ${path.basename(document.fileName)}`, presenter))) {
            return;
        }
        let check: OfflineCheck;
        if (presenter) {
            const build = await addPresenterTools(context, document, htmlPath, true);
            if (!build) {
                return;
            }
            check = { markdown: document.getText(), ...build };
        } else {
            const html = await fs.promises.readFile(htmlPath, 'utf8');
            const { report } = await inlineDeck(html, path.dirname(document.uri.fsPath), { fetchFont: url => fetchFontCached(context, url) });
            check = { markdown: document.getText(), report };
        }
        const count = showOfflineIssues(document, check);
        if (count === 0) {
            vscode.window.showInformationMessage(`${path.basename(document.fileName)} is ready to present without an internet connection.`);
        } else {
            await announceOfflineIssues(document, count);
        }
    } finally {
        await fs.promises.rm(dir, { recursive: true, force: true });
    }
}

/** Offer to open the exported file, or its folder. */
async function announce(outputPath: string, message: string, extra: string[] = []): Promise<string | undefined> {
    const actions = [...extra, 'Open', 'Show in Folder'];
    const choice = await vscode.window.showInformationMessage(message, ...actions);
    if (choice === 'Open') {
        await vscode.env.openExternal(vscode.Uri.file(outputPath));
    } else if (choice === 'Show in Folder') {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputPath));
    }
    return choice;
}

async function announceForGoogleSlides(outputPath: string): Promise<void> {
    const choice = await announce(
        outputPath,
        `Saved ${path.basename(outputPath)}. To edit it in Google Slides, upload it to Google Drive `
        + '(New > File upload), then open it with Google Slides.',
        ['Open Google Drive']
    );
    if (choice === 'Open Google Drive') {
        await vscode.env.openExternal(vscode.Uri.parse(GOOGLE_DRIVE_URL));
    }
}

/**
 * Run Marp CLI to convert `document` to `outputPath` in `format`, with a
 * cancellable progress notification. Reports failures itself; returns true
 * when the output was written.
 */
async function convertWithMarp(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
    format: MarpExportFormat,
    outputPath: string,
    title: string,
    presenter = false,
    quiet = false
): Promise<boolean> {
    const cli = await resolveMarpCli(context);
    if (!cli) {
        return false;
    }

    const config = vscode.workspace.getConfiguration('scimax.marp', document.uri);
    const input = document.uri.fsPath;
    const allowLocalFiles = config.get<boolean>('allowLocalFiles', true) && vscode.workspace.isTrusted;
    const args = buildMarpArgs(input, outputPath, format, {
        allowLocalFiles,
        // Presenter decks may use HTML widgets (e.g. iframes), as marp-present always allowed.
        enableHtml: presenter || marpHtmlEnabled(document),
        engine: presenter ? context.asAbsolutePath(path.join('media', 'marpPresent', 'engine.cjs')) : undefined,
        themeFiles: marpThemeUris(document).filter(uri => fs.existsSync(uri.fsPath)).map(uri => uri.fsPath),
        browserPath: config.get<string>('browserPath', '').trim() || undefined,
    });
    const env = { ...process.env };
    const soffice = config.get<string>('libreOfficePath', '').trim();
    if (soffice) {
        env.SOFFICE_PATH = soffice;
    }

    let result: RunResult;
    try {
        result = await vscode.window.withProgress(
            { location: quiet ? vscode.ProgressLocation.Window : vscode.ProgressLocation.Notification, title, cancellable: !quiet },
            (_progress, token) => run(cli.command, [...cli.prefix, ...args], { cwd: path.dirname(input), env }, token)
        );
    } catch (error) {
        vscode.window.showErrorMessage(`Could not run Marp CLI: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
    if (result.cancelled) {
        vscode.window.setStatusBarMessage('Marp export cancelled', 3000);
        return false;
    }
    if (result.code !== 0) {
        await reportMarpFailure(context, format, result);
        return false;
    }
    if (localFilesWereBlocked(result.output)) {
        vscode.window.showWarningMessage(
            vscode.workspace.isTrusted
                ? 'Some local images were left out. Enable scimax.marp.allowLocalFiles to include them.'
                : 'Some local images were left out because this workspace is not trusted.'
        );
    }
    return true;
}

async function exportWithMarp(context: vscode.ExtensionContext, format: MarpExportFormat, forGoogleSlides = false): Promise<void> {
    const document = await activeDeck();
    if (!document) {
        return;
    }
    const input = document.uri.fsPath;
    const outputPath = marpOutputPath(input, format);
    const shownName = format === 'images' ? `${path.parse(input).name}.001.png, ...` : path.basename(outputPath);
    const presenter = presenterEnabled(document);
    if (!(await convertWithMarp(context, document, format, outputPath, `Exporting ${shownName}`, presenter))) {
        return;
    }
    if (format === 'html' && presenter) {
        const build = await addPresenterTools(context, document, outputPath);
        if (!build) {
            return;
        }
        const issues = offlineDeck(document) ? showOfflineIssues(document, { markdown: document.getText(), ...build }) : 0;
        await announce(outputPath, `Exported ${path.basename(outputPath)} with presenter tools: a pen, l laser, n note, s save with ink`);
        await announceOfflineIssues(document, issues);
        return;
    }

    if (format === 'googleSlides' || forGoogleSlides) {
        await announceForGoogleSlides(outputPath);
    } else if (format === 'images') {
        const choice = await vscode.window.showInformationMessage(`Exported slides as ${shownName}`, 'Show in Folder');
        if (choice) {
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(input));
        }
    } else {
        await announce(outputPath, `Exported ${MARP_FORMATS[format].label}: ${path.basename(outputPath)}`);
    }
}

async function reportMarpFailure(context: vscode.ExtensionContext, format: MarpExportFormat, result: RunResult): Promise<void> {
    const failure = describeMarpFailure(result.code, result.output);
    if (failure.kind === 'libreoffice') {
        // Editable PowerPoint has two other routes.
        const choice = await vscode.window.showErrorMessage(
            failure.message,
            'Use Pandoc Instead',
            'Image PowerPoint Instead',
            'Get LibreOffice'
        );
        if (choice === 'Use Pandoc Instead') {
            await exportWithPandoc(format === 'googleSlides');
        } else if (choice === 'Image PowerPoint Instead') {
            await exportWithMarp(context, 'pptx', format === 'googleSlides');
        } else if (choice === 'Get LibreOffice') {
            await vscode.env.openExternal(vscode.Uri.parse(LIBREOFFICE_URL));
        }
        return;
    }
    const choice = await vscode.window.showErrorMessage(failure.message, 'Show Log');
    if (choice) {
        log().show();
    }
}

/**
 * Editable PowerPoint through Pandoc: real text boxes and speaker notes, in
 * PowerPoint's default look or `scimax.marp.pandocReferenceDoc`'s. Marp
 * themes do not carry over.
 */
async function exportWithPandoc(forGoogleSlides = false): Promise<void> {
    const document = await activeDeck();
    if (!document) {
        return;
    }
    if (!checkPandoc().available) {
        const choice = await vscode.window.showErrorMessage(
            'Editable PowerPoint through Pandoc needs Pandoc.',
            'Get Pandoc'
        );
        if (choice) {
            await vscode.env.openExternal(vscode.Uri.parse('https://pandoc.org/installing.html'));
        }
        return;
    }

    const input = document.uri.fsPath;
    const dir = path.dirname(input);
    const outputPath = path.join(dir, `${path.parse(input).name}-pandoc.pptx`);
    let referenceDoc = vscode.workspace.getConfiguration('scimax.marp', document.uri)
        .get<string>('pandocReferenceDoc', '').trim();
    if (referenceDoc && !path.isAbsolute(referenceDoc)) {
        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        referenceDoc = path.join(folder ? folder.uri.fsPath : dir, referenceDoc);
    }

    let result: RunResult;
    try {
        result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Exporting ${path.basename(outputPath)}`, cancellable: true },
            (_progress, token) => run(
                'pandoc',
                buildPandocPptxArgs(outputPath, dir, referenceDoc || undefined),
                { cwd: dir, input: marpToPandocMarkdown(document.getText(), slideStarts(document.getText())) },
                token
            )
        );
    } catch (error) {
        vscode.window.showErrorMessage(`Could not run Pandoc: ${error instanceof Error ? error.message : String(error)}`);
        return;
    }
    if (result.cancelled) {
        vscode.window.setStatusBarMessage('Pandoc export cancelled', 3000);
        return;
    }
    if (result.code !== 0) {
        const detail = result.output.trim().split(/\r?\n/).filter(Boolean).pop() ?? `exit code ${result.code}`;
        const choice = await vscode.window.showErrorMessage(`Pandoc export failed: ${detail}`, 'Show Log');
        if (choice) {
            log().show();
        }
        return;
    }
    if (forGoogleSlides) {
        await announceForGoogleSlides(outputPath);
    } else {
        await announce(outputPath, `Exported editable PowerPoint: ${path.basename(outputPath)}`);
    }
}

/** Arguments of `scimax.marp.present`, as passed by a `marp:` org link. */
interface PresentArgs {
    /** Absolute path of the deck. */
    file?: string;
    /** 1-based slide to start at. */
    slide?: number;
}

/** The deck at `file`, saved if it has unsaved changes. */
async function deckAt(file: string): Promise<vscode.TextDocument | undefined> {
    let document: vscode.TextDocument;
    try {
        document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    } catch {
        vscode.window.showErrorMessage(`Cannot open the slide deck ${file}.`);
        return undefined;
    }
    if (!isMarpText(document.getText())) {
        vscode.window.showWarningMessage(`${path.basename(file)} is not a Marp deck (no marp: true in its front matter).`);
        return undefined;
    }
    if (document.isDirty && !(await document.save())) {
        return undefined;
    }
    return document;
}

/**
 * Number (1-based, counting only slides that are shown) of the slide under
 * the cursor, if the deck is the active editor. A hidden slide gives the next
 * shown one.
 */
function slideUnderCursor(document: vscode.TextDocument): number | undefined {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document !== document) {
        return undefined;
    }
    const text = document.getText();
    const slides = parseDeck(text, slideStarts(text)).slides;
    const line = editor.selection.active.line;
    let index = slides.findIndex((slide, i) => line >= slide.startLine && (i + 1 >= slides.length || line < slides[i + 1].startLine));
    if (index < 0) {
        index = 0;
    }
    const shownBefore = slides.slice(0, index).filter(slide => !slide.hidden).length;
    return shownBefore + 1;
}

/** True if the deck asks for offline Python (`presenter: offline`). */
function offlineDeck(document: vscode.TextDocument): boolean {
    return presenterOffline(frontMatterValue(document.getText().split(/\r?\n/), 'presenter'));
}

/** A slideshow that reloads when its deck is saved. */
interface LiveShow {
    output: string;
    presenter: boolean;
    building: boolean;
    again: boolean;
}

/** Open slideshows by deck path, rebuilt on save while the deck is open. */
const liveShows = new Map<string, LiveShow>();

/**
 * Build the slideshow of `document` into `output`. With live reload, the page
 * checks `<output>.version.js` every second and reloads (at `jumpTo`, if
 * given) when a rebuild writes a new version. Returns false if it failed.
 */
async function buildSlideshow(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
    output: string,
    options: { presenter: boolean; startSlide?: number; jumpTo?: number; liveReload: boolean; quiet: boolean }
): Promise<boolean> {
    const presenter = options.presenter;
    // Marp writes a scratch file next to the slideshow; the open page only ever sees a finished one.
    const scratch = path.join(path.dirname(output), `.${randomBytes(8).toString('hex')}.html`);
    try {
        const title = options.quiet ? `Updating slideshow of ${path.basename(document.fileName)}` : `Preparing slideshow of ${path.basename(document.fileName)}`;
        if (!(await convertWithMarp(context, document, 'html', scratch, title, presenter, options.quiet))) {
            return false;
        }
        if (presenter) {
            const build = await addPresenterTools(context, document, scratch, options.quiet);
            if (!build) {
                return false;
            }
            if (offlineDeck(document)) {
                const issues = showOfflineIssues(document, { markdown: document.getText(), ...build });
                if (!options.quiet) {
                    void announceOfflineIssues(document, issues);
                }
            }
        }
        const version = randomBytes(8).toString('hex');
        const versionFile = `${output}.version.js`;
        const reload = options.liveReload ? { url: pathToFileURL(versionFile).href, version } : undefined;
        const folderUrl = pathToFileURL(path.dirname(document.uri.fsPath) + path.sep).href;
        const html = await fs.promises.readFile(scratch, 'utf8');
        await fs.promises.writeFile(scratch, prepareSlideshowHtml(html, folderUrl, options.startSlide, reload), 'utf8');
        await fs.promises.rename(scratch, output);
        if (reload) {
            await fs.promises.writeFile(versionFile, liveReloadVersionScript(version, options.jumpTo), 'utf8');
        }
        return true;
    } finally {
        await fs.promises.rm(scratch, { force: true });
    }
}

/** Rebuild an open slideshow after its deck is saved (one rebuild at a time). */
async function rebuildLiveShow(context: vscode.ExtensionContext, document: vscode.TextDocument): Promise<void> {
    const show = liveShows.get(document.uri.fsPath);
    if (!show || !isMarpText(document.getText())) {
        return;
    }
    if (show.building) {
        show.again = true;
        return;
    }
    show.building = true;
    try {
        do {
            show.again = false;
            await buildSlideshow(context, document, show.output, {
                presenter: show.presenter && presenterRequested(frontMatterValue(document.getText().split(/\r?\n/), 'presenter')),
                jumpTo: slideUnderCursor(document), liveReload: true, quiet: true,
            });
        } while (show.again);
    } finally {
        show.building = false;
    }
}

/**
 * Present the deck as Marp's HTML slideshow in the browser: F for full
 * screen, P for the presenter view with notes and a timer, arrow keys or
 * clicks to move. The HTML goes to a private folder of the extension, the
 * same one each time for a deck (presenter tools keep ink in the browser's
 * storage, keyed by the page's path). With `scimax.marp.liveReload`, saving
 * the deck updates the open slideshow.
 */
async function present(context: vscode.ExtensionContext, args?: PresentArgs, fromCursor = false): Promise<void> {
    const document = args?.file ? await deckAt(args.file) : await activeDeck();
    if (!document) {
        return;
    }
    const startSlide = args?.slide ?? (fromCursor ? slideUnderCursor(document) : undefined);
    const dir = path.join(context.globalStorageUri.fsPath, 'slideshows',
        createHash('sha256').update(document.uri.fsPath).digest('hex').slice(0, 16));
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    const output = path.join(dir, `${path.parse(document.uri.fsPath).name}.html`);
    const liveReload = vscode.workspace.getConfiguration('scimax.marp', document.uri).get<boolean>('liveReload', true);
    const presenter = presenterEnabled(document);

    // A rebuild in progress would overwrite this one's start slide; wait for it.
    const previous = liveShows.get(document.uri.fsPath);
    liveShows.delete(document.uri.fsPath);
    while (previous?.building) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!(await buildSlideshow(context, document, output, { presenter, startSlide, liveReload, quiet: false }))) {
        return;
    }
    if (liveReload) {
        liveShows.set(document.uri.fsPath, { output, presenter: vscode.workspace.isTrusted, building: false, again: false });
    }
    await vscode.env.openExternal(vscode.Uri.file(output));
    const reloadHint = liveReload ? '; saving the deck updates it' : '';
    vscode.window.setStatusBarMessage(presenter
        ? `Slideshow opened: F full screen, P presenter view, a pen, l laser, n note, s save with ink${reloadHint}`
        : `Slideshow opened in the browser: F for full screen, P for presenter view${reloadHint}`, 6000);
}

export function registerMarpExportCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.marp.exportMenu', () =>
            vscode.commands.executeCommand('scimax.hydra.show', 'scimax.marp.export')
        ),
        vscode.commands.registerCommand('scimax.marp.present', (args?: PresentArgs) =>
            present(context, args && typeof args.file === 'string' ? args : undefined)
        ),
        vscode.commands.registerCommand('scimax.marp.presentFromCurrent', () => present(context, undefined, true)),
        vscode.commands.registerCommand('scimax.marp.exportPdf', () => exportWithMarp(context, 'pdf')),
        vscode.commands.registerCommand('scimax.marp.exportPdfNotes', () => exportWithMarp(context, 'pdfNotes')),
        vscode.commands.registerCommand('scimax.marp.exportPptx', () => exportWithMarp(context, 'pptx')),
        vscode.commands.registerCommand('scimax.marp.exportPptxEditable', () => exportWithMarp(context, 'pptxEditable')),
        vscode.commands.registerCommand('scimax.marp.exportPptxPandoc', () => exportWithPandoc()),
        vscode.commands.registerCommand('scimax.marp.exportGoogleSlides', () => exportForGoogleSlides(context)),
        vscode.commands.registerCommand('scimax.marp.exportHtml', () => exportWithMarp(context, 'html')),
        vscode.commands.registerCommand('scimax.marp.exportImages', () => exportWithMarp(context, 'images')),
        vscode.commands.registerCommand('scimax.marp.exportNotes', () => exportWithMarp(context, 'notes')),
        vscode.commands.registerCommand('scimax.marp.checkOffline', () => checkOffline(context)),
        vscode.workspace.onDidSaveTextDocument(document => {
            if (liveShows.has(document.uri.fsPath)) {
                void rebuildLiveShow(context, document);
            }
        }),
        vscode.workspace.onDidCloseTextDocument(document => {
            liveShows.delete(document.uri.fsPath);
            offlineDiagnostics?.delete(document.uri);
        }),
        { dispose: () => offlineDiagnostics?.dispose() }
    );
}
