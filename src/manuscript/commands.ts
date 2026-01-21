/**
 * VS Code Commands for LaTeX manuscript flattening
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { flattenManuscript, previewFlatten } from './manuscriptManager';
import { checkIfCompilationNeeded } from './latexCompiler';
import { FlattenOptions } from './types';

/**
 * Get the active .tex file or prompt user to select one
 */
async function getTexFile(): Promise<string | undefined> {
  const editor = vscode.window.activeTextEditor;

  // Check if current file is a .tex file
  if (editor && editor.document.fileName.endsWith('.tex')) {
    return editor.document.fileName;
  }

  // Prompt user to select a .tex file
  const files = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { 'LaTeX files': ['tex'] },
    title: 'Select main LaTeX file',
  });

  if (files && files.length > 0) {
    return files[0].fsPath;
  }

  return undefined;
}

/**
 * Command: Flatten manuscript for submission
 */
async function flattenManuscriptCommand(): Promise<void> {
  const texFile = await getTexFile();
  if (!texFile) {
    vscode.window.showWarningMessage('No LaTeX file selected');
    return;
  }

  // Check if compilation is needed
  const needsCompile = await checkIfCompilationNeeded(texFile);
  let compileOption: boolean | 'if-needed' = 'if-needed';

  if (needsCompile) {
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: '$(run) Compile first',
          description: 'Run pdflatex + bibtex to update .bbl (recommended)',
          value: 'compile' as const,
        },
        {
          label: '$(file) Use existing .bbl',
          description: 'May be out of date',
          value: 'existing' as const,
        },
        {
          label: '$(x) Cancel',
          value: 'cancel' as const,
        },
      ],
      {
        placeHolder: '.bbl may be out of date. Compile first?',
      }
    );

    if (!choice || choice.value === 'cancel') {
      return;
    }

    compileOption = choice.value === 'compile';
  }

  // Show progress
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Flattening manuscript...',
      cancellable: false,
    },
    async (progress: vscode.Progress<{ message?: string }>) => {
      try {
        progress.report({ message: 'Processing...' });

        const options: FlattenOptions = {
          compile: compileOption,
        };

        const result = await flattenManuscript(texFile, options);

        // Build summary message
        const summary: string[] = [];
        summary.push(`Output: ${path.basename(result.outputDir)}/`);
        summary.push(`Figures: ${result.figuresCopied.length}`);
        if (result.supportFilesCopied.length > 0) {
          summary.push(`Support files: ${result.supportFilesCopied.length}`);
        }
        summary.push(`Bibliography: ${result.bblInlined ? 'inlined' : 'not inlined'}`);
        summary.push(`PDF: ${result.pdfCompiled ? 'compiled' : 'not compiled'}`);

        if (result.warnings.length > 0) {
          summary.push(`Warnings: ${result.warnings.length}`);
        }

        // Determine available actions based on results
        const actions: string[] = ['Open Folder'];
        if (result.pdfCompiled && result.outputPdfPath) {
          actions.push('Open PDF');
        }
        if (result.warnings.length > 0) {
          actions.push('Show Warnings');
        }

        // Show success message with option to open folder or PDF
        const action = await vscode.window.showInformationMessage(
          `Manuscript flattened successfully! ${summary.join(' | ')}`,
          ...actions
        );

        if (action === 'Open Folder') {
          const uri = vscode.Uri.file(result.outputDir);
          await vscode.commands.executeCommand('revealFileInOS', uri);
        } else if (action === 'Open PDF' && result.outputPdfPath) {
          const uri = vscode.Uri.file(result.outputPdfPath);
          await vscode.commands.executeCommand('vscode.open', uri);
        } else if (action === 'Show Warnings' && result.warnings.length > 0) {
          const doc = await vscode.workspace.openTextDocument({
            content: result.warnings.join('\n'),
            language: 'plaintext',
          });
          await vscode.window.showTextDocument(doc);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to flatten manuscript: ${message}`);
      }
    }
  );
}

/**
 * Command: Preview flattening (dry run)
 */
async function previewFlattenCommand(): Promise<void> {
  const texFile = await getTexFile();
  if (!texFile) {
    vscode.window.showWarningMessage('No LaTeX file selected');
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Analyzing manuscript...',
      cancellable: false,
    },
    async () => {
      try {
        const preview = await previewFlatten(texFile);

        const lines: string[] = [
          `Manuscript Flattening Preview`,
          `=============================`,
          ``,
          `Main file: ${path.basename(texFile)}`,
          ``,
          `Will process:`,
          `  - ${preview.includesCount} included file(s)`,
          `  - ${preview.figuresCount} figure(s) to rename`,
          `  - ${preview.supportFilesCount} support file(s) to copy`,
          `  - Bibliography: ${preview.hasBibliography ? 'Yes' : 'No'}`,
          `  - Needs compilation: ${preview.needsCompilation ? 'Yes' : 'No'}`,
        ];

        if (preview.supportFilesList.length > 0) {
          lines.push('', `Support files (.sty, .cls, .bst, data):`,
            ...preview.supportFilesList.map(f => `  - ${f}`));
        }

        if (preview.warnings.length > 0) {
          lines.push('', `Warnings:`, ...preview.warnings.map(w => `  - ${w}`));
        }

        const doc = await vscode.workspace.openTextDocument({
          content: lines.join('\n'),
          language: 'plaintext',
        });
        await vscode.window.showTextDocument(doc);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to analyze manuscript: ${message}`);
      }
    }
  );
}

/**
 * Command: Flatten to specific directory
 */
async function flattenToDirectoryCommand(): Promise<void> {
  const texFile = await getTexFile();
  if (!texFile) {
    vscode.window.showWarningMessage('No LaTeX file selected');
    return;
  }

  // Prompt for output directory
  const folders = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Select Output Folder',
    title: 'Select output directory for flattened manuscript',
  });

  if (!folders || folders.length === 0) {
    return;
  }

  const outputDir = folders[0].fsPath;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Flattening manuscript...',
      cancellable: false,
    },
    async () => {
      try {
        const options: FlattenOptions = {
          outputDir,
          compile: 'if-needed',
        };

        const result = await flattenManuscript(texFile, options);

        const action = await vscode.window.showInformationMessage(
          `Manuscript flattened to ${result.outputDir}`,
          'Open Folder'
        );

        if (action === 'Open Folder') {
          const uri = vscode.Uri.file(result.outputDir);
          await vscode.commands.executeCommand('revealFileInOS', uri);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to flatten manuscript: ${message}`);
      }
    }
  );
}

/**
 * Register all manuscript commands
 */
export function registerManuscriptCommands(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'scimax.manuscript.flatten',
      flattenManuscriptCommand
    ),
    vscode.commands.registerCommand(
      'scimax.manuscript.preview',
      previewFlattenCommand
    ),
    vscode.commands.registerCommand(
      'scimax.manuscript.flattenToDirectory',
      flattenToDirectoryCommand
    )
  );
}
