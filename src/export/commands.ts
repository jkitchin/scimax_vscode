/**
 * VS Code Commands for Custom Exporters
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import {
    ExporterRegistry,
    ExporterRoute,
    executeCustomExport,
    initializeExporterRegistry,
    getDefaultExporterPaths,
    resolveCustomExporterRouteForContent,
    EXAMPLE_CMU_MEMO_MANIFEST,
    EXAMPLE_CMU_MEMO_TEMPLATE,
} from './customExporter';
import { parseOrgFast } from '../parser/orgExportParser';
import { resolveProfileForDocument, runProfile, readBuildKeywords } from '../latex/buildProfileService';
import { createLogger, getLoggingService } from '../utils/logger';

const log = createLogger('Export');

/**
 * Determine the base output name (without extension) for a custom export,
 * honoring the #+EXPORT_FILE_NAME keyword when present.
 *
 * Any trailing known output extension on EXPORT_FILE_NAME is stripped so the
 * appropriate extension for the current stage (e.g. .tex then .pdf) can be
 * applied. Falls back to the input file's base name when the keyword is unset.
 */
function getCustomExportBaseName(content: string, defaultName: string): string {
    try {
        const doc = parseOrgFast(content);
        const exportFileName = doc.keywords?.EXPORT_FILE_NAME?.trim();
        if (exportFileName) {
            return exportFileName.replace(/\.(pdf|tex|html|md)$/i, '');
        }
    } catch {
        // Fall through to default on any parse error
    }
    return defaultName;
}

/**
 * Get custom exporter search paths from settings
 */
function getExporterSearchPaths(): string[] {
    const config = vscode.workspace.getConfiguration('scimax.export');
    const additionalPaths = config.get<string[]>('customExporterPaths', []);

    // Expand ~ in paths
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const expandedPaths = additionalPaths.map(p =>
        p.startsWith('~') ? p.replace('~', homeDir) : p
    );

    // Add workspace .scimax/exporters if exists
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
        expandedPaths.push(path.join(workspaceFolder.uri.fsPath, '.scimax', 'exporters'));
    }

    return expandedPaths;
}

/**
 * Log every problem the last load ran into, and return how many were fatal.
 *
 * A manifest that will not parse used to fail silently (a console.warn nobody
 * sees), which looks exactly like "my exporter does not show up" - see #56.
 */
function reportExporterIssues(): number {
    const issues = ExporterRegistry.getInstance().getLoadIssues();
    for (const issue of issues) {
        const message = `${issue.path}: ${issue.message}`;
        if (issue.severity === 'error') {
            log.error(message);
        } else {
            log.warn(message);
        }
    }
    return issues.filter(i => i.severity === 'error').length;
}

/**
 * Show the exporter load problems, or say that there are none.
 */
async function showExporterIssues(): Promise<void> {
    const issues = ExporterRegistry.getInstance().getLoadIssues();

    if (issues.length === 0) {
        const searched = getSearchedPaths().join('\n');
        vscode.window.showInformationMessage(
            `No custom exporter problems. ${ExporterRegistry.getInstance().getAll().length} exporter(s) loaded.`,
            { modal: false, detail: `Searched:\n${searched}` }
        );
        return;
    }

    reportExporterIssues();

    const items = issues.map(issue => ({
        label: `$(${issue.severity === 'error' ? 'error' : 'warning'}) ${path.basename(issue.path)}`,
        description: issue.path,
        detail: issue.message,
        issue,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        title: 'Custom Exporter Problems',
        placeHolder: 'Select a problem to open its manifest.json',
    });

    if (!selected) return;

    const manifestPath = path.join(selected.issue.path, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
        const doc = await vscode.workspace.openTextDocument(manifestPath);
        await vscode.window.showTextDocument(doc);
    } else {
        getLoggingService().show();
    }
}

/**
 * Every directory the registry looks in, for messages that need to say where.
 */
function getSearchedPaths(): string[] {
    return [...getDefaultExporterPaths(), ...getExporterSearchPaths()];
}

/**
 * Reload the exporter registry
 */
async function reloadExporters(): Promise<void> {
    const additionalPaths = getExporterSearchPaths();
    await initializeExporterRegistry(additionalPaths);

    const registry = ExporterRegistry.getInstance();
    const count = registry.getAll().length;
    const errors = reportExporterIssues();

    if (errors > 0) {
        const action = await vscode.window.showWarningMessage(
            `Loaded ${count} custom exporter(s); ${errors} could not be loaded.`,
            'Show Problems'
        );
        if (action === 'Show Problems') {
            await showExporterIssues();
        }
        return;
    }

    if (count > 0) {
        vscode.window.showInformationMessage(`Loaded ${count} custom exporter(s)`);
    }
}

/**
 * Show picker for custom exporters
 */
async function showCustomExportPicker(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'org') {
        vscode.window.showWarningMessage('No org-mode file open');
        return;
    }

    const registry = ExporterRegistry.getInstance();
    const exporters = registry.getAll();

    if (exporters.length === 0) {
        const errors = registry.getLoadErrors().length;
        const actions = errors > 0
            ? ['Show Problems', 'Create Example', 'Open Exporters Folder']
            : ['Create Example', 'Open Exporters Folder'];
        const message = errors > 0
            ? `No custom exporters loaded - ${errors} could not be read (check manifest.json).`
            : 'No custom exporters found. Would you like to create one?';

        const action = await vscode.window.showWarningMessage(
            message,
            { modal: false, detail: `Searched:\n${getSearchedPaths().join('\n')}` },
            ...actions
        );

        if (action === 'Show Problems') {
            await showExporterIssues();
        } else if (action === 'Create Example') {
            await createExampleExporter();
        } else if (action === 'Open Exporters Folder') {
            await openExportersFolder();
        }
        return;
    }

    // Build picker items
    const items = exporters.map(exp => ({
        label: `$(file-text) ${exp.name}`,
        description: exp.description || '',
        detail: `Output: ${exp.outputFormat.toUpperCase()} via ${exp.parent}`,
        exporter: exp,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select custom exporter',
        title: 'Custom Export',
    });

    if (!selected) return;

    // Execute the export
    await runCustomExport(selected.exporter.id);
}

/**
 * Options controlling how a custom export is run
 */
export interface CustomExportRunOptions {
    /**
     * Org content to export. Defaults to the active editor's text.
     * Callers that preprocess (e.g. resolve `#+INCLUDE`) should pass their text.
     */
    content?: string;
    /**
     * Stop after writing the rendered template (skip the PDF compile).
     * Only meaningful for exporters whose `outputFormat` is `pdf`.
     */
    texOnly?: boolean;
    /**
     * What to do with the result: open it, offer an 'Open' button, or nothing.
     * Defaults to 'open'.
     */
    openBehavior?: 'open' | 'prompt' | 'none';
    /** Extra context appended to the success message (e.g. why this exporter ran) */
    note?: string;
}

/**
 * Execute a custom export by exporter ID
 */
export async function runCustomExport(
    exporterId: string,
    options: CustomExportRunOptions = {}
): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'org') {
        vscode.window.showWarningMessage('No org-mode file open');
        return;
    }

    const registry = ExporterRegistry.getInstance();
    const exporter = registry.get(exporterId);

    if (!exporter) {
        vscode.window.showErrorMessage(`Custom exporter not found: ${exporterId}`);
        return;
    }

    const openBehavior = options.openBehavior ?? 'open';
    const inputPath = editor.document.uri.fsPath;
    const inputDir = path.dirname(inputPath);
    const inputName = path.basename(inputPath, '.org');
    const content = options.content ?? editor.document.getText();
    const suffix = options.note ? ` ${options.note}` : '';

    // Determine output name, honoring #+EXPORT_FILE_NAME if set
    const baseName = getCustomExportBaseName(content, inputName);
    const outputExt = exporter.outputFormat === 'pdf' ? '.tex' : `.${exporter.outputFormat}`;
    const outputPath = path.join(inputDir, `${baseName}${outputExt}`);

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Exporting with ${exporter.name}...`,
            cancellable: false,
        },
        async () => {
            try {
                const result = await executeCustomExport(exporterId, content);

                // Write output file
                await fs.promises.writeFile(outputPath, result, 'utf-8');

                // If PDF output, compile LaTeX (unless the caller only wants .tex)
                if (exporter.outputFormat === 'pdf' && !options.texOnly) {
                    const pdfPath = outputPath.replace(/\.tex$/, '.pdf');
                    await compileToPdf(outputPath, pdfPath, inputDir, content);
                    await handleExportResult(pdfPath, openBehavior, suffix, false);
                } else {
                    await handleExportResult(outputPath, openBehavior, suffix, true);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Export failed: ${message}`);
            }
        }
    );
}

/**
 * Open / offer to open an exported file, or just report it.
 *
 * Text results (.tex, .html, .md) open in an editor; PDFs open externally.
 */
async function handleExportResult(
    outputPath: string,
    openBehavior: 'open' | 'prompt' | 'none',
    suffix: string,
    isTextOutput: boolean
): Promise<void> {
    const open = async () => {
        if (isTextOutput) {
            const doc = await vscode.workspace.openTextDocument(outputPath);
            await vscode.window.showTextDocument(doc);
        } else {
            await vscode.env.openExternal(vscode.Uri.file(outputPath));
        }
    };

    if (openBehavior === 'open') {
        await open();
        return;
    }

    const message = `Exported to ${path.basename(outputPath)}${suffix}`;
    if (openBehavior === 'none') {
        vscode.window.showInformationMessage(message);
        return;
    }

    const action = await vscode.window.showInformationMessage(message, 'Open');
    if (action === 'Open') {
        await open();
    }
}

// =============================================================================
// Automatic Routing
// =============================================================================

/**
 * Get the `#+LATEX_CLASS` -> custom exporter mapping from settings
 */
export function getLatexClassExporterMap(): Record<string, string> {
    const config = vscode.workspace.getConfiguration('scimax.export');
    return config.get<Record<string, string>>('latexClassExporters', {}) || {};
}

/**
 * Decide whether a document should be exported with a custom exporter.
 *
 * Uses `#+EXPORTER:` if present, otherwise the `scimax.export.latexClassExporters`
 * mapping applied to `#+LATEX_CLASS`.
 */
export function resolveExporterForContent(content: string): ExporterRoute {
    return resolveCustomExporterRouteForContent(content, getLatexClassExporterMap());
}

/**
 * Run the routed custom exporter for `content`, if there is one.
 *
 * Returns true when the export was handled by a custom exporter, so callers can
 * skip their built-in LaTeX/PDF path.
 */
export async function tryRouteCustomExport(
    content: string,
    options: Omit<CustomExportRunOptions, 'content' | 'note'> = {}
): Promise<boolean> {
    const route = resolveExporterForContent(content);

    if (route.reason === 'unknown-exporter') {
        vscode.window.showWarningMessage(
            `Custom exporter "${route.requested}" is not installed - using the built-in LaTeX export. ` +
            `Run "Scimax: Reload Custom Exporters" if you just added it.`
        );
        return false;
    }

    if (!route.exporterId) {
        return false;
    }

    const note = route.reason === 'latex-class'
        ? `(#+LATEX_CLASS: ${route.latexClass})`
        : '(#+EXPORTER)';

    await runCustomExport(route.exporterId, { ...options, content, note });
    return true;
}

/**
 * Auxiliary file extensions to clean up after successful PDF compilation
 */
const LATEX_AUX_EXTENSIONS = [
    '.aux', '.log', '.out', '.toc', '.lof', '.lot',
    '.bbl', '.blg', '.bcf', '.run.xml',
    '.nav', '.snm', '.vrb',
    '.fdb_latexmk', '.fls', '.synctex.gz',
    '.idx', '.ilg', '.ind',
];

/**
 * Clean up auxiliary files after successful PDF compilation
 */
async function cleanupAuxFiles(texPath: string): Promise<void> {
    const basePath = texPath.replace(/\.tex$/, '');

    for (const ext of LATEX_AUX_EXTENSIONS) {
        const auxPath = basePath + ext;
        try {
            await fs.promises.unlink(auxPath);
        } catch {
            // File doesn't exist or can't be deleted - ignore
        }
    }
}

/**
 * Compile LaTeX to PDF using system LaTeX compiler
 *
 * When the source document selects a build profile, its command sequence runs
 * instead of the single-compiler path. `sourceContent` is the org text, which
 * is where the `#+LATEX_BUILD:` keyword lives.
 */
async function compileToPdf(
    texPath: string,
    pdfPath: string,
    cwd: string,
    sourceContent?: string
): Promise<void> {
    const profile = resolveProfileForDocument(
        texPath,
        sourceContent ? readBuildKeywords(sourceContent) : undefined
    );

    if (profile) {
        await runProfile(profile, texPath, cwd);
        if (!fs.existsSync(pdfPath)) {
            throw new Error(
                `LaTeX build profile "${profile.name}" did not produce ${path.basename(pdfPath)}`
            );
        }
        const cleanAux = vscode.workspace
            .getConfiguration('scimax.export.pdf')
            .get<boolean>('cleanAuxFiles', true);
        if (cleanAux) {
            await cleanupAuxFiles(texPath);
        }
        return;
    }

    const config = vscode.workspace.getConfiguration('scimax.export.pdf');
    const compiler = config.get<string>('compiler', 'latexmk-lualatex');
    const cleanAuxFiles = config.get<boolean>('cleanAuxFiles', true);
    const shellEscape = config.get<string>('shellEscape', 'restricted');

    // Determine shell escape flag (needed for minted/pygments)
    const shellFlag = shellEscape === 'restricted' ? '-shell-restricted'
        : shellEscape === 'full' ? '-shell-escape'
        : null;

    // Build command
    let command: string;
    let args: string[];

    switch (compiler) {
        case 'latexmk-lualatex':
            command = 'latexmk';
            args = ['-lualatex', '-interaction=nonstopmode', texPath];
            break;
        case 'latexmk-pdflatex':
            command = 'latexmk';
            args = ['-pdf', '-interaction=nonstopmode', texPath];
            break;
        case 'latexmk-xelatex':
            command = 'latexmk';
            args = ['-xelatex', '-interaction=nonstopmode', texPath];
            break;
        case 'pdflatex':
            command = 'pdflatex';
            args = ['-interaction=nonstopmode', texPath];
            break;
        case 'lualatex':
            command = 'lualatex';
            args = ['-interaction=nonstopmode', texPath];
            break;
        case 'xelatex':
            command = 'xelatex';
            args = ['-interaction=nonstopmode', texPath];
            break;
        default:
            command = 'latexmk';
            args = ['-lualatex', '-interaction=nonstopmode', texPath];
    }

    // Add shell escape flag if needed (before the tex file path)
    if (shellFlag) {
        // Insert before the last arg (texPath)
        args.splice(args.length - 1, 0, shellFlag);
    }

    // Read TEXMFHOME from environment (per user's guidance)
    const env = { ...process.env };

    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, { cwd, env });

        // Use arrays to avoid O(n²) string concatenation for large outputs
        const stdoutChunks: string[] = [];
        const stderrChunks: string[] = [];

        proc.stdout?.on('data', (data: Buffer) => {
            stdoutChunks.push(data.toString());
        });

        proc.stderr?.on('data', (data: Buffer) => {
            stderrChunks.push(data.toString());
        });

        proc.on('close', async (code) => {
            if (code === 0 || fs.existsSync(pdfPath)) {
                // Clean up auxiliary files if enabled and PDF was created
                if (cleanAuxFiles && fs.existsSync(pdfPath)) {
                    await cleanupAuxFiles(texPath);
                }
                resolve();
            } else {
                const stderr = stderrChunks.join('');
                const stdout = stdoutChunks.join('');
                reject(new Error(`LaTeX compilation failed: ${stderr || stdout}`));
            }
        });

        proc.on('error', reject);
    });
}

/**
 * Open the exporters folder
 */
async function openExportersFolder(): Promise<void> {
    const paths = getDefaultExporterPaths();
    const exportersDir = paths[0]; // Use first default path

    // Create directory if it doesn't exist
    if (!fs.existsSync(exportersDir)) {
        await fs.promises.mkdir(exportersDir, { recursive: true });
    }

    await vscode.env.openExternal(vscode.Uri.file(exportersDir));
}

/**
 * Create an example exporter
 */
async function createExampleExporter(): Promise<void> {
    const paths = getDefaultExporterPaths();
    const exportersDir = paths[0];

    // Create the example exporter directory
    const exampleDir = path.join(exportersDir, 'cmu-memo');

    if (fs.existsSync(exampleDir)) {
        vscode.window.showInformationMessage('Example exporter already exists');
        return;
    }

    await fs.promises.mkdir(exampleDir, { recursive: true });

    // Write manifest
    await fs.promises.writeFile(
        path.join(exampleDir, 'manifest.json'),
        JSON.stringify(EXAMPLE_CMU_MEMO_MANIFEST, null, 2),
        'utf-8'
    );

    // Write template
    await fs.promises.writeFile(
        path.join(exampleDir, 'template.tex'),
        EXAMPLE_CMU_MEMO_TEMPLATE,
        'utf-8'
    );

    // Reload exporters
    await reloadExporters();

    // Open the example directory
    const action = await vscode.window.showInformationMessage(
        'Created example CMU Memo exporter',
        'Open Template',
        'Open Folder'
    );

    if (action === 'Open Template') {
        const doc = await vscode.workspace.openTextDocument(
            path.join(exampleDir, 'template.tex')
        );
        await vscode.window.showTextDocument(doc);
    } else if (action === 'Open Folder') {
        await vscode.env.openExternal(vscode.Uri.file(exampleDir));
    }
}

/**
 * Register VS Code commands for custom exporters
 */
export function registerCustomExportCommands(context: vscode.ExtensionContext): void {
    // Initialize registry on extension activation. Problems are logged (not
    // shown) here - the user finds them via the picker or "Show Custom Exporter
    // Problems"; a modal on startup would be worse than the silence it replaces.
    const additionalPaths = getExporterSearchPaths();
    initializeExporterRegistry(additionalPaths)
        .then(() => reportExporterIssues())
        .catch(error => log.error('Failed to initialize exporter registry', error as Error));

    // Show custom export picker
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.export.custom',
            showCustomExportPicker
        )
    );

    // Reload exporters
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.export.reloadCustomExporters',
            reloadExporters
        )
    );

    // Open exporters folder
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.export.openExportersFolder',
            openExportersFolder
        )
    );

    // Show why an exporter did not load
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.export.showExporterProblems',
            showExporterIssues
        )
    );

    // Create example exporter
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.export.createExampleExporter',
            createExampleExporter
        )
    );

    // Execute specific exporter by ID
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'scimax.export.customById',
            async (exporterId: string) => {
                if (exporterId) {
                    await runCustomExport(exporterId);
                } else {
                    await showCustomExportPicker();
                }
            }
        )
    );
}
