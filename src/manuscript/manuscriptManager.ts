/**
 * Manuscript Manager for LaTeX manuscript flattening
 *
 * Orchestrates the complete flattening process:
 * 1. Compile LaTeX to generate .bbl (optional)
 * 2. Flatten \input/\include commands
 * 3. Inline .bbl content
 * 4. Rename and copy figures
 * 5. Write flattened output to submission directory
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { FlattenOptions, FlattenResult } from './types';
import { compileForBbl, checkIfCompilationNeeded, compileFinalPdf } from './latexCompiler';
import { flattenIncludes } from './fileFlattener';
import { processBibliography } from './bibliographyHandler';
import { processFigures, copyFigures } from './figureProcessor';
import { detectSupportFiles, copySupportFiles } from './supportFiles';

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
 * Generate a submission directory name with datestamp (local time)
 */
function generateSubmissionDirName(): string {
  const now = new Date();
  // Use local date components to avoid timezone issues
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const datestamp = `${year}-${month}-${day}`;
  return `submission-${datestamp}`;
}

/**
 * Create the submission directory, handling existing directories
 */
async function createSubmissionDir(baseDir: string): Promise<string> {
  const dirName = generateSubmissionDirName();
  let finalPath = path.join(baseDir, dirName);

  // If directory exists, add suffix: submission-2026-01-20-2, -3, etc.
  if (await fileExists(finalPath)) {
    let suffix = 2;
    while (await fileExists(`${finalPath}-${suffix}`)) {
      suffix++;
    }
    finalPath = `${finalPath}-${suffix}`;
  }

  await fs.mkdir(finalPath, { recursive: true });
  return finalPath;
}

/**
 * Flatten a LaTeX manuscript for journal submission
 *
 * This function:
 * 1. Optionally compiles the document to generate/update the .bbl file
 * 2. Flattens all \input and \include commands
 * 3. Inlines the .bbl file content (replacing \bibliography commands)
 * 4. Renames figures sequentially (1.pdf, 2.png, etc.)
 * 5. Copies everything to a timestamped submission directory
 *
 * @param mainTexPath Path to the main .tex file
 * @param options Flattening options
 * @returns Result containing output paths and any warnings
 */
export async function flattenManuscript(
  mainTexPath: string,
  options: FlattenOptions = {}
): Promise<FlattenResult> {
  const {
    outputDir,
    compile = 'if-needed',
    bibtexBackend = 'auto',
    maxDepth = 20,
    compileTimeout = 60000,
    compileFinalPdf: shouldCompilePdf = true,
  } = options;

  const warnings: string[] = [];
  let compilationRun = false;

  // Validate input file exists
  if (!(await fileExists(mainTexPath))) {
    throw new Error(`File not found: ${mainTexPath}`);
  }

  const rootDir = path.dirname(mainTexPath);
  const texBasename = path.basename(mainTexPath);

  // Step 1: Compile if needed
  if (compile === true || compile === 'if-needed') {
    const needsCompile = compile === true || (await checkIfCompilationNeeded(mainTexPath));

    if (needsCompile) {
      const compileResult = await compileForBbl({
        workingDir: rootDir,
        texFile: texBasename,
        bibtexBackend,
        timeout: compileTimeout,
      });

      compilationRun = true;

      if (!compileResult.success) {
        warnings.push(...compileResult.errors);
      }

      if (!compileResult.bblGenerated) {
        warnings.push('Warning: .bbl file was not generated during compilation');
      }
    }
  }

  // Step 2: Read and flatten includes
  const mainContent = await fs.readFile(mainTexPath, 'utf-8');
  const flattenResult = await flattenIncludes(mainContent, mainTexPath, {
    rootDir,
    maxDepth,
  });

  warnings.push(...flattenResult.warnings);
  let content = flattenResult.content;

  // Step 3: Process bibliography
  const bibResult = await processBibliography(content, mainTexPath);
  warnings.push(...bibResult.warnings);
  content = bibResult.content;

  // Step 4: Process figures
  const figureResult = await processFigures(content, rootDir);
  warnings.push(...figureResult.warnings);
  content = figureResult.updatedContent;

  // Step 5: Create output directory
  const submissionDir = outputDir || (await createSubmissionDir(rootDir));

  // Ensure output directory exists
  await fs.mkdir(submissionDir, { recursive: true });

  // Step 6: Write flattened .tex file
  const outputTexPath = path.join(submissionDir, texBasename);
  await fs.writeFile(outputTexPath, content, 'utf-8');

  // Step 7: Copy figures
  if (figureResult.mappings.length > 0) {
    const copyResult = await copyFigures(figureResult.mappings, submissionDir);
    if (copyResult.errors.length > 0) {
      warnings.push(...copyResult.errors);
    }
  }

  // Step 8: Detect and copy support files (.sty, .cls, .bst, data files)
  const supportFilesResult = await detectSupportFiles(content, rootDir);
  warnings.push(...supportFilesResult.warnings);

  let supportFilesCopied: string[] = [];
  if (supportFilesResult.files.length > 0) {
    const supportCopyResult = await copySupportFiles(supportFilesResult.files, submissionDir);
    supportFilesCopied = supportCopyResult.copied;
    if (supportCopyResult.errors.length > 0) {
      warnings.push(...supportCopyResult.errors);
    }
  }

  // Step 9: Compile the flattened tex to PDF
  let pdfCompiled = false;
  let outputPdfPath: string | undefined;

  if (shouldCompilePdf) {
    const pdfResult = await compileFinalPdf({
      workingDir: submissionDir,
      texFile: texBasename,
      timeout: compileTimeout,
    });

    pdfCompiled = pdfResult.success;
    outputPdfPath = pdfResult.pdfPath;

    if (!pdfResult.success) {
      warnings.push(...pdfResult.errors);
    }
  }

  return {
    outputDir: submissionDir,
    outputTexPath,
    outputPdfPath,
    figuresCopied: figureResult.mappings,
    supportFilesCopied,
    bblInlined: bibResult.bblInlined,
    warnings,
    compilationRun,
    pdfCompiled,
  };
}

/**
 * Preview what flattening would do without making changes
 *
 * Returns a summary of what would happen
 */
export async function previewFlatten(mainTexPath: string): Promise<{
  includesCount: number;
  figuresCount: number;
  supportFilesCount: number;
  supportFilesList: string[];
  hasBibliography: boolean;
  needsCompilation: boolean;
  warnings: string[];
}> {
  const warnings: string[] = [];

  if (!(await fileExists(mainTexPath))) {
    throw new Error(`File not found: ${mainTexPath}`);
  }

  const rootDir = path.dirname(mainTexPath);
  const content = await fs.readFile(mainTexPath, 'utf-8');

  // Parse the document
  const { parseLatexDocument } = await import('./latexParser');
  const parsed = parseLatexDocument(content);

  // Check compilation status
  const needsCompilation = await checkIfCompilationNeeded(mainTexPath);

  // Count nested includes (recursive)
  const flattenResult = await flattenIncludes(content, mainTexPath, {
    rootDir,
    maxDepth: 20,
  });
  warnings.push(...flattenResult.warnings);

  // Process figures to get accurate count
  const figureResult = await processFigures(flattenResult.content, rootDir);
  warnings.push(...figureResult.warnings);

  // Detect support files
  const supportFilesResult = await detectSupportFiles(flattenResult.content, rootDir);
  warnings.push(...supportFilesResult.warnings);

  return {
    includesCount: flattenResult.includedFiles.length,
    figuresCount: figureResult.mappings.length,
    supportFilesCount: supportFilesResult.files.length,
    supportFilesList: supportFilesResult.files.map(f => f.name),
    hasBibliography: parsed.bibliographyCommands.length > 0,
    needsCompilation,
    warnings,
  };
}
