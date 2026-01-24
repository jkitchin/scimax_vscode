/**
 * VS Code Commands for Custom Exporters
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import {
    ExporterRegistry,
    executeCustomExport,
    initializeExporterRegistry,
    getDefaultExporterPaths,
    EXAMPLE_CMU_MEMO_MANIFEST,
    EXAMPLE_CMU_MEMO_TEMPLATE,
} from './customExporter';

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
 * Reload the exporter registry
 */
async function reloadExporters(): Promise<void> {
    const additionalPaths = getExporterSearchPaths();
    await initializeExporterRegistry(additionalPaths);

    const registry = ExporterRegistry.getInstance();
    const count = registry.getAll().length;

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
        const action = await vscode.window.showWarningMessage(
            'No custom exporters found. Would you like to create one?',
            'Create Example',
            'Open Exporters Folder'
        );

        if (action === 'Create Example') {
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
    await executeCustomExportCommand(selected.exporter.id);
}

/**
 * Execute a custom export by exporter ID
 */
async function executeCustomExportCommand(exporterId: string): Promise<void> {
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

    const inputPath = editor.document.uri.fsPath;
    const inputDir = path.dirname(inputPath);
    const inputName = path.basename(inputPath, '.org');
    const content = editor.document.getText();

    // Determine output extension
    const outputExt = exporter.outputFormat === 'pdf' ? '.tex' : `.${exporter.outputFormat}`;
    const outputPath = path.join(inputDir, `${inputName}${outputExt}`);

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

                // If PDF output, compile LaTeX and open the PDF
                if (exporter.outputFormat === 'pdf') {
                    const pdfPath = outputPath.replace(/\.tex$/, '.pdf');
                    await compileToPdf(outputPath, pdfPath, inputDir);
                    await vscode.env.openExternal(vscode.Uri.file(pdfPath));
                } else {
                    const action = await vscode.window.showInformationMessage(
                        `Exported to ${path.basename(outputPath)}`,
                        'Open'
                    );

                    if (action === 'Open') {
                        const doc = await vscode.workspace.openTextDocument(outputPath);
                        await vscode.window.showTextDocument(doc);
                    }
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Export failed: ${message}`);
            }
        }
    );
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
 */
async function compileToPdf(texPath: string, pdfPath: string, cwd: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('scimax.export.pdf');
    const compiler = config.get<string>('compiler', 'latexmk-lualatex');
    const cleanAuxFiles = config.get<boolean>('cleanAuxFiles', true);

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
    // Initialize registry on extension activation
    const additionalPaths = getExporterSearchPaths();
    initializeExporterRegistry(additionalPaths).catch(console.error);

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
                    await executeCustomExportCommand(exporterId);
                } else {
                    await showCustomExportPicker();
                }
            }
        )
    );
}
