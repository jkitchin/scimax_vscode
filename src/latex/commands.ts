/**
 * LaTeX Commands Registration
 * Registers all LaTeX navigation, structure, and environment commands
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { LaTeXDocumentSymbolProvider } from './latexDocumentSymbolProvider';
import { LaTeXHoverProvider } from './latexHoverProvider';
import * as navigation from './latexNavigation';
import * as structure from './latexStructure';
import * as environments from './latexEnvironments';
import { registerSpeedCommands } from './latexSpeedCommands';
import { initLatexPreviewCache } from '../org/latexPreviewProvider';
import {
    LaTeXDefinitionProvider,
    LaTeXReferenceProvider,
    LaTeXCompletionProvider,
    LaTeXRenameProvider,
    LaTeXFormattingProvider,
    LaTeXRangeFormattingProvider,
    runChkTeX,
    clearDiagnostics,
    disposeDiagnostics,
    clearProjectCache,
    validateReferences,
    clearRefValidationDiagnostics,
    disposeRefValidationDiagnostics,
    formatLatexDocument,
    startInverseSyncTeXServer,
    getInverseSyncTeXCommand,
    loadUserDictionary,
    saveUserDictionary,
    addToUserDictionary,
    disposeSpellCheckDiagnostics,
} from './latexLanguageProvider';
import { openPdfInPanel, syncForwardToPanel, PdfViewerPanel } from './pdfViewerPanel';

/**
 * Register all LaTeX-related commands
 */
export function registerLatexCommands(context: vscode.ExtensionContext): void {
    // Navigation commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.latex.nextSection', navigation.nextSection),
        vscode.commands.registerCommand('scimax.latex.previousSection', navigation.previousSection),
        vscode.commands.registerCommand('scimax.latex.parentSection', navigation.parentSection),
        vscode.commands.registerCommand('scimax.latex.nextSiblingSection', navigation.nextSiblingSection),
        vscode.commands.registerCommand('scimax.latex.previousSiblingSection', navigation.previousSiblingSection),
        vscode.commands.registerCommand('scimax.latex.firstSection', navigation.firstSection),
        vscode.commands.registerCommand('scimax.latex.lastSection', navigation.lastSection),
        vscode.commands.registerCommand('scimax.latex.jumpToSection', navigation.jumpToSection),
        vscode.commands.registerCommand('scimax.latex.nextEnvironment', navigation.nextEnvironment),
        vscode.commands.registerCommand('scimax.latex.previousEnvironment', navigation.previousEnvironment),
        vscode.commands.registerCommand('scimax.latex.jumpToEnvironment', navigation.jumpToEnvironment),
        vscode.commands.registerCommand('scimax.latex.jumpToLabel', navigation.jumpToLabel),
        vscode.commands.registerCommand('scimax.latex.jumpToMatchingEnvironment', navigation.jumpToMatchingEnvironment),
    );

    // Structure editing commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.latex.promoteSection', structure.promoteSection),
        vscode.commands.registerCommand('scimax.latex.demoteSection', structure.demoteSection),
        vscode.commands.registerCommand('scimax.latex.promoteSubtree', structure.promoteSubtree),
        vscode.commands.registerCommand('scimax.latex.demoteSubtree', structure.demoteSubtree),
        vscode.commands.registerCommand('scimax.latex.moveSectionUp', structure.moveSectionUp),
        vscode.commands.registerCommand('scimax.latex.moveSectionDown', structure.moveSectionDown),
        vscode.commands.registerCommand('scimax.latex.markSection', structure.markSection),
        vscode.commands.registerCommand('scimax.latex.killSection', structure.killSection),
        vscode.commands.registerCommand('scimax.latex.cloneSection', structure.cloneSection),
        vscode.commands.registerCommand('scimax.latex.insertSection', structure.insertSection),
        vscode.commands.registerCommand('scimax.latex.insertSubsection', structure.insertSubsection),
        vscode.commands.registerCommand('scimax.latex.narrowToSection', structure.narrowToSection),
        vscode.commands.registerCommand('scimax.latex.widen', structure.widen),
    );

    // Environment commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.latex.selectEnvironment', environments.selectEnvironment),
        vscode.commands.registerCommand('scimax.latex.selectEnvironmentContent', environments.selectEnvironmentContent),
        vscode.commands.registerCommand('scimax.latex.changeEnvironment', environments.changeEnvironment),
        vscode.commands.registerCommand('scimax.latex.wrapInEnvironment', environments.wrapInEnvironment),
        vscode.commands.registerCommand('scimax.latex.unwrapEnvironment', environments.unwrapEnvironment),
        vscode.commands.registerCommand('scimax.latex.deleteEnvironment', environments.deleteEnvironment),
        vscode.commands.registerCommand('scimax.latex.toggleEnvironmentStar', environments.toggleEnvironmentStar),
        vscode.commands.registerCommand('scimax.latex.addLabel', environments.addLabelToEnvironment),
        vscode.commands.registerCommand('scimax.latex.addCaption', environments.addCaptionToEnvironment),
        vscode.commands.registerCommand('scimax.latex.environmentInfo', environments.environmentInfo),
    );

    // Register speed commands
    registerSpeedCommands(context);
}

/**
 * Register LaTeX language providers
 */
export function registerLatexProviders(context: vscode.ExtensionContext): void {
    const latexSelector = { language: 'latex', scheme: 'file' };

    // Document Symbol Provider (for outline view)
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            latexSelector,
            new LaTeXDocumentSymbolProvider()
        )
    );

    // Hover Provider (for tooltips)
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            latexSelector,
            new LaTeXHoverProvider()
        )
    );

    // Definition Provider (go to definition for labels, citations, commands)
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            latexSelector,
            new LaTeXDefinitionProvider()
        )
    );

    // Reference Provider (find all references to labels, citations)
    context.subscriptions.push(
        vscode.languages.registerReferenceProvider(
            latexSelector,
            new LaTeXReferenceProvider()
        )
    );

    // Completion Provider (auto-complete labels, citations, environments)
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            latexSelector,
            new LaTeXCompletionProvider(),
            '{', ',', '\\' // Trigger characters
        )
    );

    // Rename Provider (rename labels and update all references)
    context.subscriptions.push(
        vscode.languages.registerRenameProvider(
            latexSelector,
            new LaTeXRenameProvider()
        )
    );

    // Formatting Provider (latexindent integration)
    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider(
            latexSelector,
            new LaTeXFormattingProvider()
        )
    );

    context.subscriptions.push(
        vscode.languages.registerDocumentRangeFormattingEditProvider(
            latexSelector,
            new LaTeXRangeFormattingProvider()
        )
    );

    // Start inverse SyncTeX server for PDF to source jumping
    startInverseSyncTeXServer(context);

    // Load user dictionary for spell checking
    loadUserDictionary(context);

    // ChkTeX diagnostics
    const config = vscode.workspace.getConfiguration('scimax.latex');
    if (config.get<boolean>('enableChktex', true)) {
        // Run on open
        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(doc => {
                if (doc.languageId === 'latex') {
                    runChkTeX(doc);
                }
            })
        );

        // Run on save
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(doc => {
                if (doc.languageId === 'latex') {
                    runChkTeX(doc);
                }
            })
        );

        // Clear on close
        context.subscriptions.push(
            vscode.workspace.onDidCloseTextDocument(doc => {
                if (doc.languageId === 'latex') {
                    clearDiagnostics(doc);
                }
            })
        );

        // Run on already open documents
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.languageId === 'latex') {
                runChkTeX(doc);
            }
        }
    }

    // Reference validation (undefined/unused labels)
    if (config.get<boolean>('validateReferences', true)) {
        // Run on open
        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(doc => {
                if (doc.languageId === 'latex') {
                    validateReferences(doc);
                }
            })
        );

        // Run on save
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(doc => {
                if (doc.languageId === 'latex') {
                    validateReferences(doc);
                }
            })
        );

        // Run on already open documents
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.languageId === 'latex') {
                validateReferences(doc);
            }
        }
    }

    // Clear project cache when files change
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(() => {
            clearProjectCache();
        })
    );

    // Cleanup on deactivate
    context.subscriptions.push({
        dispose: async () => {
            disposeDiagnostics();
            disposeRefValidationDiagnostics();
            disposeSpellCheckDiagnostics();
            clearProjectCache();
            await saveUserDictionary(context);
        }
    });
}

// Store errors for navigation
interface LaTeXError {
    file: string;
    line: number;
    message: string;
}
let lastCompileErrors: LaTeXError[] = [];
let currentErrorIndex = 0;

/**
 * Format LaTeX log output for better readability with text markers
 */
function formatLatexOutput(output: string): string {
    const lines = output.split('\n');
    const formatted: string[] = [];

    for (const line of lines) {
        let result = line;

        // Critical errors - add marker
        if (/^!/.test(line)) {
            result = `❌ ${line}`;
        }
        else if (/Emergency stop/.test(line) || /Fatal error/.test(line)) {
            result = `🛑 ${line}`;
        }
        // File:line: error format
        else if (/^[^:]+:\d+:/.test(line)) {
            result = `⚠️  ${line}`;
        }
        // Warnings
        else if (/Warning:/i.test(line) || /LaTeX Warning/.test(line)) {
            result = `⚠️  ${line}`;
        }
        // Missing character warnings
        else if (/Missing character:/.test(line)) {
            result = `⚠️  ${line}`;
        }
        // Citation/reference undefined
        else if (/Citation .* undefined/.test(line) || /Reference .* undefined/.test(line)) {
            result = `📚 ${line}`;
        }
        // Output written successfully
        else if (/Output written on/.test(line)) {
            result = `✅ ${line}`;
        }
        else if (/Transcript written on/.test(line)) {
            result = `📝 ${line}`;
        }

        formatted.push(result);
    }

    return formatted.join('\n');
}

/**
 * Parse LaTeX log for errors
 */
function parseLatexErrors(output: string, baseDir: string): LaTeXError[] {
    const errors: LaTeXError[] = [];
    const lines = output.split('\n');

    // Pattern for file:line: error
    const errorPattern = /^([^:]+):(\d+): (.+)$/;
    // Pattern for ! Error
    const bangPattern = /^! (.+)$/;
    // Pattern for l.123 ...
    const linePattern = /^l\.(\d+)/;

    let currentFile = '';
    let pendingError = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Standard file:line:error format
        const errorMatch = errorPattern.exec(line);
        if (errorMatch) {
            const file = path.isAbsolute(errorMatch[1])
                ? errorMatch[1]
                : path.join(baseDir, errorMatch[1]);
            errors.push({
                file,
                line: parseInt(errorMatch[2], 10),
                message: errorMatch[3],
            });
            continue;
        }

        // TeX-style ! Error
        const bangMatch = bangPattern.exec(line);
        if (bangMatch) {
            pendingError = bangMatch[1];
            continue;
        }

        // l.123 shows line number for pending error
        if (pendingError) {
            const lineMatch = linePattern.exec(line);
            if (lineMatch) {
                errors.push({
                    file: currentFile || path.join(baseDir, 'document.tex'),
                    line: parseInt(lineMatch[1], 10),
                    message: pendingError,
                });
                pendingError = '';
            }
        }

        // Track current file from (filename
        const fileOpenMatch = line.match(/\(([^()]+\.tex)/);
        if (fileOpenMatch) {
            currentFile = path.isAbsolute(fileOpenMatch[1])
                ? fileOpenMatch[1]
                : path.join(baseDir, fileOpenMatch[1]);
        }
    }

    return errors;
}

/**
 * Register LaTeX compile and preview commands
 */
export function registerLatexCompileCommands(context: vscode.ExtensionContext): void {
    // Create output channel
    const outputChannel = vscode.window.createOutputChannel('LaTeX');

    // Compile LaTeX document
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.latex.compile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'latex') {
                vscode.window.showWarningMessage('No LaTeX document open');
                return;
            }

            // Save the document first
            await editor.document.save();

            const filePath = editor.document.uri.fsPath;
            const dir = path.dirname(filePath);
            const fileName = path.basename(filePath);

            // Get compiler from settings
            const config = vscode.workspace.getConfiguration('scimax.latex');
            const compiler = config.get<string>('compiler', 'pdflatex');

            // Build command and args based on compiler
            let cmd: string;
            let args: string[];

            if (compiler === 'latexmk') {
                // Use latexmk for smart builds
                const engine = config.get<string>('latexmkEngine', 'pdflatex');
                cmd = 'latexmk';
                args = [
                    `-${engine === 'lualatex' ? 'lualatex' : engine === 'xelatex' ? 'xelatex' : 'pdf'}`,
                    '-interaction=nonstopmode',
                    '-file-line-error',
                    '-synctex=1',
                    fileName
                ];
            } else {
                cmd = compiler;
                args = [
                    '-interaction=nonstopmode',
                    '-file-line-error',
                    '-synctex=1',
                    fileName
                ];
            }

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Compiling ${fileName}...`,
                cancellable: true
            }, async (progress, token) => {
                return new Promise<void>((resolve, reject) => {
                    const proc = spawn(cmd, args, {
                        cwd: dir,
                        env: {
                            ...process.env,
                            PATH: getEnhancedPath(),
                        }
                    });

                    let stdout = '';
                    let stderr = '';

                    proc.stdout?.on('data', (data: Buffer) => {
                        stdout += data.toString();
                    });

                    proc.stderr?.on('data', (data: Buffer) => {
                        stderr += data.toString();
                    });

                    token.onCancellationRequested(() => {
                        proc.kill();
                        reject(new Error('Compilation cancelled'));
                    });

                    proc.on('close', (code: number | null) => {
                        // Parse errors
                        lastCompileErrors = parseLatexErrors(stdout, dir);
                        currentErrorIndex = 0;

                        if (code === 0) {
                            vscode.window.showInformationMessage(`LaTeX compilation successful: ${fileName}`);
                            resolve();
                        } else {
                            // Show first error with navigation option
                            if (lastCompileErrors.length > 0) {
                                const firstError = lastCompileErrors[0];
                                vscode.window.showErrorMessage(
                                    `LaTeX error at line ${firstError.line}: ${firstError.message}`,
                                    'Go to Error',
                                    'Next Error',
                                    'Show Log'
                                ).then(action => {
                                    if (action === 'Go to Error' || action === 'Next Error') {
                                        vscode.commands.executeCommand('scimax.latex.nextError');
                                    } else if (action === 'Show Log') {
                                        outputChannel.show(true);
                                    }
                                });
                            } else {
                                vscode.window.showErrorMessage(
                                    'LaTeX compilation failed. Check Output for details.',
                                    'Show Log'
                                ).then(action => {
                                    if (action === 'Show Log') {
                                        outputChannel.show(true);
                                    }
                                });
                            }

                            // Show output in output channel
                            outputChannel.clear();
                            outputChannel.appendLine(`════════════════════════════════════════════════════════`);
                            outputChannel.appendLine(`  LaTeX Compilation: ${fileName}`);
                            outputChannel.appendLine(`  Compiler: ${cmd} ${args.join(' ')}`);
                            outputChannel.appendLine(`  Exit code: ${code}`);
                            outputChannel.appendLine(`════════════════════════════════════════════════════════`);
                            outputChannel.appendLine('');
                            outputChannel.appendLine(formatLatexOutput(stdout));
                            if (stderr) {
                                outputChannel.appendLine('');
                                outputChannel.appendLine('--- STDERR ---');
                                outputChannel.appendLine(formatLatexOutput(stderr));
                            }

                            resolve();
                        }
                    });

                    proc.on('error', (err: Error) => {
                        vscode.window.showErrorMessage(`Failed to run ${compiler}: ${err.message}`);
                        resolve();
                    });
                });
            });
        }),

        // View PDF command
        vscode.commands.registerCommand('scimax.latex.viewPdf', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'latex') {
                vscode.window.showWarningMessage('No LaTeX document open');
                return;
            }

            const filePath = editor.document.uri.fsPath;
            const pdfPath = filePath.replace(/\.tex$/, '.pdf');

            if (!fs.existsSync(pdfPath)) {
                const compile = await vscode.window.showWarningMessage(
                    'PDF not found. Compile the document first?',
                    'Compile',
                    'Cancel'
                );
                if (compile === 'Compile') {
                    await vscode.commands.executeCommand('scimax.latex.compile');
                    // Wait a bit for compilation
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    if (!fs.existsSync(pdfPath)) {
                        return; // Compilation probably failed
                    }
                } else {
                    return;
                }
            }

            // Open PDF with default viewer or VS Code extension
            const pdfUri = vscode.Uri.file(pdfPath);

            // Try to open in VS Code if a PDF extension is available
            try {
                await vscode.commands.executeCommand('vscode.open', pdfUri);
            } catch {
                // Fallback to system default
                vscode.env.openExternal(pdfUri);
            }
        }),

        // Compile and view command
        vscode.commands.registerCommand('scimax.latex.compileAndView', async () => {
            await vscode.commands.executeCommand('scimax.latex.compile');
            // Wait for compilation to finish, then open PDF
            // The compile command shows progress, so user can see when it's done
            setTimeout(() => {
                vscode.commands.executeCommand('scimax.latex.viewPdf');
            }, 500);
        }),

        // Clean auxiliary files
        vscode.commands.registerCommand('scimax.latex.clean', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'latex') {
                vscode.window.showWarningMessage('No LaTeX document open');
                return;
            }

            const filePath = editor.document.uri.fsPath;
            const dir = path.dirname(filePath);
            const baseName = path.basename(filePath, '.tex');

            const auxExtensions = [
                '.aux', '.log', '.out', '.toc', '.lof', '.lot',
                '.bbl', '.blg', '.bcf', '.run.xml',
                '.fls', '.fdb_latexmk', '.synctex.gz', '.synctex',
                '.nav', '.snm', '.vrb'  // Beamer
            ];

            let cleaned = 0;
            for (const ext of auxExtensions) {
                const auxFile = path.join(dir, baseName + ext);
                if (fs.existsSync(auxFile)) {
                    try {
                        fs.unlinkSync(auxFile);
                        cleaned++;
                    } catch {
                        // Ignore errors
                    }
                }
            }

            vscode.window.showInformationMessage(`Cleaned ${cleaned} auxiliary file(s)`);
        }),

        // SyncTeX forward search (jump from source to PDF)
        vscode.commands.registerCommand('scimax.latex.syncTexForward', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'latex') {
                vscode.window.showWarningMessage('No LaTeX document open');
                return;
            }

            const filePath = editor.document.uri.fsPath;
            const pdfPath = filePath.replace(/\.tex$/, '.pdf');
            const line = editor.selection.active.line + 1;

            if (!fs.existsSync(pdfPath)) {
                vscode.window.showWarningMessage('PDF not found. Compile the document first.');
                return;
            }

            // Try common PDF viewers with SyncTeX support
            const config = vscode.workspace.getConfiguration('scimax.latex');
            const pdfViewer = config.get<string>('pdfViewer', 'auto');

            if (pdfViewer === 'auto' || pdfViewer === 'skim') {
                // Skim on macOS - use displayline script for reliable SyncTeX
                if (process.platform === 'darwin') {
                    const displayline = '/Applications/Skim.app/Contents/SharedSupport/displayline';
                    // Check if displayline exists, fall back to AppleScript if not
                    if (fs.existsSync(displayline)) {
                        // displayline [-r] [-b] [-g] LINE SOURCE PDF
                        // -r: don't bring Skim to foreground, -b: read from background, -g: don't open new window
                        spawn(displayline, ['-b', String(line), filePath, pdfPath]);
                    } else {
                        // Fallback to AppleScript
                        const script = `
                            tell application "Skim"
                                activate
                                open POSIX file "${pdfPath.replace(/"/g, '\\"')}"
                                tell document 1
                                    go to TeX line ${line} from POSIX file "${filePath.replace(/"/g, '\\"')}"
                                end tell
                            end tell
                        `;
                        spawn('osascript', ['-e', script]);
                    }
                    return;
                }
            }

            if (pdfViewer === 'auto' || pdfViewer === 'zathura') {
                // Zathura on Linux
                if (process.platform === 'linux') {
                    spawn('zathura', ['--synctex-forward', `${line}:1:${filePath}`, pdfPath]);
                    return;
                }
            }

            if (pdfViewer === 'auto' || pdfViewer === 'sumatra') {
                // SumatraPDF on Windows
                if (process.platform === 'win32') {
                    spawn('SumatraPDF', ['-forward-search', filePath, String(line), pdfPath]);
                    return;
                }
            }

            // Fallback: just open the PDF
            vscode.window.showInformationMessage('SyncTeX forward search: opening PDF at line ' + line);
            await vscode.commands.executeCommand('scimax.latex.viewPdf');
        }),

        // Word count
        vscode.commands.registerCommand('scimax.latex.wordCount', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'latex') {
                vscode.window.showWarningMessage('No LaTeX document open');
                return;
            }

            const text = editor.document.getText();

            // Remove comments
            const noComments = text.replace(/%.*$/gm, '');

            // Remove commands (rough approximation)
            const noCommands = noComments.replace(/\\[a-zA-Z]+(\[[^\]]*\])?(\{[^}]*\})?/g, ' ');

            // Remove environments markers
            const noEnvMarkers = noCommands.replace(/\\(begin|end)\{[^}]+\}/g, '');

            // Count words
            const words = noEnvMarkers.match(/\b[a-zA-Z]+\b/g) || [];
            const wordCount = words.length;

            // Count characters (excluding whitespace)
            const charCount = noEnvMarkers.replace(/\s/g, '').length;

            vscode.window.showInformationMessage(
                `Word count: ${wordCount} words, ${charCount} characters (approximate)`
            );
        }),

        // Insert common LaTeX elements
        vscode.commands.registerCommand('scimax.latex.insertFigure', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const snippet = new vscode.SnippetString(
                '\\begin{figure}[${1:htbp}]\n' +
                '  \\centering\n' +
                '  \\includegraphics[width=${2:0.8}\\textwidth]{${3:filename}}\n' +
                '  \\caption{${4:Caption}}\n' +
                '  \\label{fig:${5:label}}\n' +
                '\\end{figure}\n'
            );

            await editor.insertSnippet(snippet);
        }),

        vscode.commands.registerCommand('scimax.latex.insertTable', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const snippet = new vscode.SnippetString(
                '\\begin{table}[${1:htbp}]\n' +
                '  \\centering\n' +
                '  \\caption{${2:Caption}}\n' +
                '  \\label{tab:${3:label}}\n' +
                '  \\begin{tabular}{${4:lcc}}\n' +
                '    \\toprule\n' +
                '    ${5:Header 1} & ${6:Header 2} & ${7:Header 3} \\\\\\\\\n' +
                '    \\midrule\n' +
                '    ${8:Data 1} & ${9:Data 2} & ${10:Data 3} \\\\\\\\\n' +
                '    \\bottomrule\n' +
                '  \\end{tabular}\n' +
                '\\end{table}\n'
            );

            await editor.insertSnippet(snippet);
        }),

        vscode.commands.registerCommand('scimax.latex.insertEquation', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const snippet = new vscode.SnippetString(
                '\\begin{equation}\n' +
                '  ${1:equation}\n' +
                '  \\label{eq:${2:label}}\n' +
                '\\end{equation}\n'
            );

            await editor.insertSnippet(snippet);
        }),

        // Error navigation commands
        vscode.commands.registerCommand('scimax.latex.nextError', async () => {
            if (lastCompileErrors.length === 0) {
                vscode.window.showInformationMessage('No LaTeX errors to navigate');
                return;
            }

            const error = lastCompileErrors[currentErrorIndex];
            currentErrorIndex = (currentErrorIndex + 1) % lastCompileErrors.length;

            try {
                const doc = await vscode.workspace.openTextDocument(error.file);
                const editor = await vscode.window.showTextDocument(doc);
                const line = Math.max(0, error.line - 1);
                const pos = new vscode.Position(line, 0);
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);

                vscode.window.showInformationMessage(
                    `Error ${currentErrorIndex}/${lastCompileErrors.length}: ${error.message}`
                );
            } catch {
                vscode.window.showErrorMessage(`Could not open ${error.file}`);
            }
        }),

        vscode.commands.registerCommand('scimax.latex.previousError', async () => {
            if (lastCompileErrors.length === 0) {
                vscode.window.showInformationMessage('No LaTeX errors to navigate');
                return;
            }

            currentErrorIndex = (currentErrorIndex - 1 + lastCompileErrors.length) % lastCompileErrors.length;
            const error = lastCompileErrors[currentErrorIndex];

            try {
                const doc = await vscode.workspace.openTextDocument(error.file);
                const editor = await vscode.window.showTextDocument(doc);
                const line = Math.max(0, error.line - 1);
                const pos = new vscode.Position(line, 0);
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);

                vscode.window.showInformationMessage(
                    `Error ${currentErrorIndex + 1}/${lastCompileErrors.length}: ${error.message}`
                );
            } catch {
                vscode.window.showErrorMessage(`Could not open ${error.file}`);
            }
        }),

        vscode.commands.registerCommand('scimax.latex.showErrors', async () => {
            if (lastCompileErrors.length === 0) {
                vscode.window.showInformationMessage('No LaTeX errors from last compilation');
                return;
            }

            const items = lastCompileErrors.map((err, i) => ({
                label: `${i + 1}. Line ${err.line}: ${err.message}`,
                detail: path.basename(err.file),
                error: err,
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${lastCompileErrors.length} error(s) from last compilation`,
            });

            if (selected) {
                const error = selected.error;
                const doc = await vscode.workspace.openTextDocument(error.file);
                const editor = await vscode.window.showTextDocument(doc);
                const line = Math.max(0, error.line - 1);
                const pos = new vscode.Position(line, 0);
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            }
        }),

        // Format document with latexindent
        vscode.commands.registerCommand('scimax.latex.format', formatLatexDocument),

        // Add word to user dictionary
        vscode.commands.registerCommand('scimax.latex.addToDictionary', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const selection = editor.selection;
            let word: string;

            if (selection.isEmpty) {
                // Get word at cursor
                const range = editor.document.getWordRangeAtPosition(selection.active);
                if (!range) {
                    vscode.window.showWarningMessage('No word at cursor');
                    return;
                }
                word = editor.document.getText(range);
            } else {
                word = editor.document.getText(selection);
            }

            if (word) {
                addToUserDictionary(word);
                vscode.window.showInformationMessage(`Added "${word}" to LaTeX dictionary`);
            }
        }),

        // Show inverse SyncTeX command for PDF viewer configuration
        vscode.commands.registerCommand('scimax.latex.showInverseSyncTeXCommand', () => {
            const cmd = getInverseSyncTeXCommand();
            vscode.window.showInformationMessage(
                `Configure your PDF viewer with this inverse search command:\n${cmd}`,
                { modal: true }
            );
        }),

        // Built-in PDF viewer panel (Overleaf-like experience)
        vscode.commands.registerCommand('scimax.latex.viewPdfPanel', () => {
            openPdfInPanel(context);
        }),

        // Forward sync to PDF panel
        vscode.commands.registerCommand('scimax.latex.syncToPdfPanel', () => {
            if (PdfViewerPanel.currentPanel) {
                syncForwardToPanel();
            } else {
                // Open panel first, then sync
                openPdfInPanel(context);
            }
        })
    );
}

/**
 * Get enhanced PATH for LaTeX tools
 */
function getEnhancedPath(): string {
    const currentPath = process.env.PATH || '';
    const latexPaths = [
        '/Library/TeX/texbin',           // MacTeX
        '/usr/local/texlive/2025/bin/universal-darwin',
        '/usr/local/texlive/2024/bin/universal-darwin',
        '/usr/local/texlive/2023/bin/universal-darwin',
        '/opt/homebrew/bin',             // Homebrew on Apple Silicon
        '/usr/local/bin',                // Homebrew on Intel
        '/usr/bin',
    ];

    const pathSet = new Set(currentPath.split(path.delimiter));
    for (const p of latexPaths) {
        if (!pathSet.has(p)) {
            pathSet.add(p);
        }
    }

    return Array.from(pathSet).join(path.delimiter);
}

/**
 * Activate all LaTeX features
 */
export function activateLatexFeatures(context: vscode.ExtensionContext): void {
    // Initialize LaTeX preview cache
    initLatexPreviewCache(context);

    registerLatexCommands(context);
    registerLatexProviders(context);
    registerLatexCompileCommands(context);

    console.log('LaTeX navigation, structure, and compile features activated');
}
