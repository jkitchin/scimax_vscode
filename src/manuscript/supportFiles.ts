/**
 * Support Files Handler for LaTeX manuscripts
 *
 * Detects and copies auxiliary files needed for submission:
 * - .sty files (custom style packages)
 * - .cls files (custom document classes)
 * - .bst files (bibliography styles)
 * - .bib files (if not using .bbl inlining)
 * - Data files (.csv, .dat) used by pgfplots, etc.
 */

import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Information about a support file
 */
export interface SupportFile {
  /** Type of file */
  type: 'sty' | 'cls' | 'bst' | 'bib' | 'data' | 'other';
  /** Name as referenced in the document */
  name: string;
  /** Full resolved path */
  resolvedPath: string;
  /** Whether it's a local file (vs system-installed) */
  isLocal: boolean;
}

/**
 * Result of detecting support files
 */
export interface SupportFilesResult {
  /** Files that were found and should be copied */
  files: SupportFile[];
  /** Files that were referenced but not found locally */
  notFound: string[];
  /** Warning messages */
  warnings: string[];
}

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
 * Extract \usepackage{...} commands from LaTeX content
 */
function extractPackages(content: string): string[] {
  const packages: string[] = [];

  // Match \usepackage{pkg} or \usepackage[opts]{pkg}
  // Also handle multiple packages: \usepackage{pkg1,pkg2,pkg3}
  const regex = /\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g;

  let match;
  while ((match = regex.exec(content)) !== null) {
    const pkgList = match[1].split(',').map(p => p.trim());
    packages.push(...pkgList);
  }

  return packages;
}

/**
 * Extract \documentclass{...} from LaTeX content
 */
function extractDocumentClass(content: string): string | null {
  const match = content.match(/\\documentclass(?:\[[^\]]*\])?\{([^}]+)\}/);
  return match ? match[1].trim() : null;
}

/**
 * Extract \bibliographystyle{...} from LaTeX content
 */
function extractBibStyle(content: string): string | null {
  const match = content.match(/\\bibliographystyle\{([^}]+)\}/);
  return match ? match[1].trim() : null;
}

/**
 * Extract data file references from LaTeX content
 * Looks for \pgfplotstableread, \input with data extensions, etc.
 */
function extractDataFiles(content: string): string[] {
  const dataFiles: string[] = [];

  // \pgfplotstableread{file.csv} or \pgfplotstableread{file.dat}
  const pgfRegex = /\\pgfplotstableread(?:\[[^\]]*\])?\{([^}]+)\}/g;
  let match;
  while ((match = pgfRegex.exec(content)) !== null) {
    dataFiles.push(match[1].trim());
  }

  // \input{file.csv} or similar data files
  const inputRegex = /\\input\{([^}]+\.(?:csv|dat|txt|data))\}/gi;
  while ((match = inputRegex.exec(content)) !== null) {
    dataFiles.push(match[1].trim());
  }

  // \DTLloaddb{name}{file.csv}
  const dtlRegex = /\\DTLloaddb\{[^}]+\}\{([^}]+)\}/g;
  while ((match = dtlRegex.exec(content)) !== null) {
    dataFiles.push(match[1].trim());
  }

  return dataFiles;
}

/**
 * Detect support files referenced in a LaTeX document
 */
export async function detectSupportFiles(
  content: string,
  rootDir: string
): Promise<SupportFilesResult> {
  const files: SupportFile[] = [];
  const notFound: string[] = [];
  const warnings: string[] = [];

  // Check for local .sty files
  const packages = extractPackages(content);
  for (const pkg of packages) {
    const styPath = path.join(rootDir, `${pkg}.sty`);
    if (await fileExists(styPath)) {
      files.push({
        type: 'sty',
        name: `${pkg}.sty`,
        resolvedPath: styPath,
        isLocal: true,
      });
    }
    // Don't warn for system packages - they're expected not to be found locally
  }

  // Check for local .cls file
  const docClass = extractDocumentClass(content);
  if (docClass) {
    const clsPath = path.join(rootDir, `${docClass}.cls`);
    if (await fileExists(clsPath)) {
      files.push({
        type: 'cls',
        name: `${docClass}.cls`,
        resolvedPath: clsPath,
        isLocal: true,
      });
    }
  }

  // Check for local .bst file
  const bibStyle = extractBibStyle(content);
  if (bibStyle) {
    const bstPath = path.join(rootDir, `${bibStyle}.bst`);
    if (await fileExists(bstPath)) {
      files.push({
        type: 'bst',
        name: `${bibStyle}.bst`,
        resolvedPath: bstPath,
        isLocal: true,
      });
    } else {
      // Check if it's a standard style - if not, warn
      const standardStyles = [
        'plain', 'unsrt', 'alpha', 'abbrv', 'acm', 'ieeetr', 'siam',
        'apalike', 'apa', 'chicago', 'nature', 'science', 'cell',
        'elsarticle-num', 'elsarticle-harv', 'IEEEtran', 'IEEEtranS',
        'apsrev4-1', 'apsrev4-2', 'achemso', 'rsc'
      ];
      if (!standardStyles.includes(bibStyle) && !standardStyles.includes(bibStyle.toLowerCase())) {
        warnings.push(`Bibliography style '${bibStyle}' not found locally - may need to be included if custom`);
      }
    }
  }

  // Check for data files
  const dataFiles = extractDataFiles(content);
  for (const dataFile of dataFiles) {
    const dataPath = path.join(rootDir, dataFile);
    if (await fileExists(dataPath)) {
      files.push({
        type: 'data',
        name: path.basename(dataFile),
        resolvedPath: dataPath,
        isLocal: true,
      });
    } else {
      notFound.push(dataFile);
      warnings.push(`Data file not found: ${dataFile}`);
    }
  }

  return { files, notFound, warnings };
}

/**
 * Copy support files to the output directory
 */
export async function copySupportFiles(
  files: SupportFile[],
  outputDir: string
): Promise<{ copied: string[]; errors: string[] }> {
  const copied: string[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const destPath = path.join(outputDir, file.name);

    try {
      await fs.copyFile(file.resolvedPath, destPath);
      copied.push(file.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to copy ${file.name}: ${message}`);
    }
  }

  return { copied, errors };
}

/**
 * Get a summary of support files for display
 */
export function summarizeSupportFiles(files: SupportFile[]): string {
  if (files.length === 0) {
    return 'No local support files detected';
  }

  const byType: Record<string, string[]> = {};
  for (const file of files) {
    if (!byType[file.type]) {
      byType[file.type] = [];
    }
    byType[file.type].push(file.name);
  }

  const parts: string[] = [];
  if (byType.cls) parts.push(`Class: ${byType.cls.join(', ')}`);
  if (byType.sty) parts.push(`Styles: ${byType.sty.join(', ')}`);
  if (byType.bst) parts.push(`Bib style: ${byType.bst.join(', ')}`);
  if (byType.data) parts.push(`Data: ${byType.data.join(', ')}`);

  return parts.join(' | ');
}
