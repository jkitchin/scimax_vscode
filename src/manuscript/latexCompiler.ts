/**
 * LaTeX Compiler for manuscript flattening
 *
 * Runs pdflatex and bibtex/biber to generate up-to-date .bbl files
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { CompileOptions, CompileResult, BibBackend } from './types';
import { detectBibBackend } from './latexParser';

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a command and capture output
 */
async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeout: number = 60000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      // No shell: true for security (per CLAUDE.md)
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`${command} timed out after ${timeout}ms`));
    }, timeout);

    proc.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

/**
 * Get the configured path for a LaTeX command
 */
function getCommandPath(command: 'pdflatex' | 'bibtex' | 'biber'): string {
  const config = vscode.workspace.getConfiguration('scimax.manuscript');

  switch (command) {
    case 'pdflatex':
      return config.get<string>('pdflatexPath', 'pdflatex');
    case 'bibtex':
      return config.get<string>('bibtexPath', 'bibtex');
    case 'biber':
      return config.get<string>('biberPath', 'biber');
    default:
      return command;
  }
}

/**
 * Run pdflatex to generate .aux file
 */
async function runPdflatex(
  texFile: string,
  cwd: string,
  timeout: number
): Promise<{ success: boolean; log: string; errors: string[] }> {
  const pdflatexPath = getCommandPath('pdflatex');
  const errors: string[] = [];

  try {
    const result = await runCommand(
      pdflatexPath,
      ['-interaction=nonstopmode', '-halt-on-error', texFile],
      cwd,
      timeout
    );

    // Check for common errors in the log
    if (result.exitCode !== 0) {
      // Extract error messages from log
      const errorLines = result.stdout
        .split('\n')
        .filter(line => line.startsWith('!') || line.includes('Error:'));

      if (errorLines.length > 0) {
        errors.push(...errorLines.slice(0, 5)); // First 5 errors
      } else {
        errors.push(`pdflatex exited with code ${result.exitCode}`);
      }
    }

    return {
      success: result.exitCode === 0,
      log: result.stdout + result.stderr,
      errors,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      log: '',
      errors: [`Failed to run pdflatex: ${message}`],
    };
  }
}

/**
 * Run bibtex or biber to generate .bbl file
 */
async function runBibCommand(
  basename: string,
  backend: BibBackend,
  cwd: string,
  timeout: number
): Promise<{ success: boolean; log: string; errors: string[] }> {
  const command = backend === 'biber' ? getCommandPath('biber') : getCommandPath('bibtex');
  const errors: string[] = [];

  try {
    const result = await runCommand(command, [basename], cwd, timeout);

    if (result.exitCode !== 0) {
      // Extract error messages
      const allOutput = result.stdout + result.stderr;
      const errorLines = allOutput
        .split('\n')
        .filter(line =>
          line.toLowerCase().includes('error') ||
          line.includes('I couldn\'t') ||
          line.includes('I found no')
        );

      if (errorLines.length > 0) {
        errors.push(...errorLines.slice(0, 5));
      } else {
        errors.push(`${backend} exited with code ${result.exitCode}`);
      }
    }

    return {
      success: result.exitCode === 0,
      log: result.stdout + result.stderr,
      errors,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      log: '',
      errors: [`Failed to run ${backend}: ${message}`],
    };
  }
}

/**
 * Compile a LaTeX document to generate a .bbl file
 *
 * Runs:
 * 1. pdflatex (to generate .aux with citation keys)
 * 2. bibtex/biber (to generate .bbl from .aux and .bib)
 */
export async function compileForBbl(options: CompileOptions): Promise<CompileResult> {
  const { workingDir, texFile, bibtexBackend = 'auto', timeout = 60000 } = options;
  const errors: string[] = [];
  let log = '';

  // Ensure the .tex file exists
  const texPath = path.join(workingDir, texFile);
  if (!(await fileExists(texPath))) {
    return {
      success: false,
      bblGenerated: false,
      log: '',
      errors: [`File not found: ${texPath}`],
    };
  }

  // Step 1: Run pdflatex to generate .aux
  const pdflatexResult = await runPdflatex(texFile, workingDir, timeout);
  log += '=== pdflatex output ===\n' + pdflatexResult.log + '\n';

  if (!pdflatexResult.success) {
    errors.push(...pdflatexResult.errors);
    // Continue anyway - .aux might still be usable for bibliography
  }

  // Step 2: Detect backend and run bibtex/biber
  const basename = texFile.replace(/\.tex$/i, '');
  const content = await fs.readFile(texPath, 'utf-8');
  const backend: BibBackend =
    bibtexBackend === 'auto' ? detectBibBackend(content) : bibtexBackend;

  const bibResult = await runBibCommand(basename, backend, workingDir, timeout);
  log += `\n=== ${backend} output ===\n` + bibResult.log + '\n';

  if (!bibResult.success) {
    errors.push(...bibResult.errors);
  }

  // Check if .bbl was generated
  const bblPath = path.join(workingDir, `${basename}.bbl`);
  const bblGenerated = await fileExists(bblPath);

  if (!bblGenerated) {
    errors.push('.bbl file was not generated - document may have no citations');
  }

  return {
    success: errors.length === 0,
    bblGenerated,
    bblPath: bblGenerated ? bblPath : undefined,
    log,
    errors,
  };
}

/**
 * Compile a flattened LaTeX document to PDF
 *
 * Runs pdflatex multiple times to resolve references (no bibtex needed
 * since .bbl content is already inlined in flattened documents)
 */
export async function compileFinalPdf(options: {
  workingDir: string;
  texFile: string;
  timeout?: number;
}): Promise<{
  success: boolean;
  pdfPath?: string;
  log: string;
  errors: string[];
}> {
  const { workingDir, texFile, timeout = 120000 } = options;
  const errors: string[] = [];
  let log = '';

  // Ensure the .tex file exists
  const texPath = path.join(workingDir, texFile);
  if (!(await fileExists(texPath))) {
    return {
      success: false,
      log: '',
      errors: [`File not found: ${texPath}`],
    };
  }

  // Run pdflatex twice to resolve references
  // First pass: generate aux files
  const pass1 = await runPdflatex(texFile, workingDir, timeout);
  log += '=== pdflatex pass 1 ===\n' + pass1.log + '\n';

  if (!pass1.success) {
    errors.push(...pass1.errors);
    // Continue to second pass anyway - some warnings are non-fatal
  }

  // Second pass: resolve references
  const pass2 = await runPdflatex(texFile, workingDir, timeout);
  log += '=== pdflatex pass 2 ===\n' + pass2.log + '\n';

  if (!pass2.success) {
    // Only add errors if different from first pass
    const newErrors = pass2.errors.filter(e => !errors.includes(e));
    errors.push(...newErrors);
  }

  // Check if PDF was generated
  const basename = texFile.replace(/\.tex$/i, '');
  const pdfPath = path.join(workingDir, `${basename}.pdf`);
  const pdfGenerated = await fileExists(pdfPath);

  if (!pdfGenerated) {
    errors.push('PDF file was not generated');
  }

  // Clean up auxiliary files if PDF was successfully generated
  if (pdfGenerated) {
    const auxExtensions = [
      '.aux', '.log', '.out', '.spl', '.toc', '.lof', '.lot',
      '.bbl', '.blg', '.fls', '.fdb_latexmk', '.synctex.gz',
      '.nav', '.snm', '.vrb', // beamer files
      '.run.xml', '-blx.bib', // biblatex files
    ];

    for (const ext of auxExtensions) {
      const auxFile = path.join(workingDir, `${basename}${ext}`);
      try {
        await fs.unlink(auxFile);
      } catch {
        // File doesn't exist or can't be deleted - ignore
      }
    }
  }

  return {
    success: pdfGenerated,
    pdfPath: pdfGenerated ? pdfPath : undefined,
    log,
    errors,
  };
}

/**
 * Check if compilation is needed based on file modification times
 */
export async function checkIfCompilationNeeded(texPath: string): Promise<boolean> {
  const dir = path.dirname(texPath);
  const basename = path.basename(texPath, '.tex');
  const bblPath = path.join(dir, `${basename}.bbl`);

  // No .bbl exists - definitely need to compile
  if (!(await fileExists(bblPath))) {
    return true;
  }

  try {
    const bblStat = await fs.stat(bblPath);
    const texStat = await fs.stat(texPath);

    // .tex is newer than .bbl
    if (texStat.mtimeMs > bblStat.mtimeMs) {
      return true;
    }

    // Check .bib files
    const content = await fs.readFile(texPath, 'utf-8');
    const { extractBibFiles } = await import('./latexParser');
    const bibFiles = extractBibFiles(content);

    for (const bibFile of bibFiles) {
      // Add .bib extension if missing
      const bibFileName = bibFile.endsWith('.bib') ? bibFile : `${bibFile}.bib`;
      const bibPath = path.join(dir, bibFileName);

      if (await fileExists(bibPath)) {
        const bibStat = await fs.stat(bibPath);
        if (bibStat.mtimeMs > bblStat.mtimeMs) {
          return true; // .bib is newer than .bbl
        }
      }
    }

    return false;
  } catch {
    // If we can't determine, assume compilation is needed
    return true;
  }
}
