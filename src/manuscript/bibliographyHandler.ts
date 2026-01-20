/**
 * Bibliography Handler for LaTeX manuscripts
 *
 * Finds and inlines .bbl file content, replacing bibliography commands
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { BblResult } from './types';
import { parseLatexDocument, usesBiblatex } from './latexParser';

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
 * Find and read the .bbl file for a LaTeX document
 */
export async function findAndReadBbl(texPath: string): Promise<BblResult> {
  const dir = path.dirname(texPath);
  const basename = path.basename(texPath, '.tex');
  const bblPath = path.join(dir, `${basename}.bbl`);

  if (!(await fileExists(bblPath))) {
    return {
      content: '',
      found: false,
    };
  }

  try {
    const content = await fs.readFile(bblPath, 'utf-8');
    return {
      content,
      found: true,
      bblPath,
    };
  } catch {
    return {
      content: '',
      found: false,
    };
  }
}

/**
 * Result of replacing bibliography commands
 */
export interface ReplaceBibResult {
  /** The modified content */
  content: string;
  /** Whether any replacement was made */
  replaced: boolean;
  /** Warning messages */
  warnings: string[];
}

/**
 * Replace bibliography commands with .bbl content
 *
 * Handles both traditional BibTeX and biblatex styles:
 * - BibTeX: Replace \bibliography{...} with .bbl content
 * - Biblatex: Replace \printbibliography with .bbl content,
 *   and comment out \addbibresource
 */
export function replaceBibliographyWithBbl(
  content: string,
  bblContent: string
): ReplaceBibResult {
  const warnings: string[] = [];
  let result = content;
  let replaced = false;

  const isBiblatex = usesBiblatex(content);

  if (isBiblatex) {
    // For biblatex: replace \printbibliography with .bbl content
    const printBibRegex = /\\printbibliography(\[[^\]]*\])?/g;

    if (printBibRegex.test(result)) {
      result = result.replace(printBibRegex, () => {
        replaced = true;
        return bblContent;
      });
    } else {
      warnings.push('No \\printbibliography command found in biblatex document');
    }

    // Comment out \addbibresource commands (they reference external .bib files)
    result = result.replace(
      /^([ \t]*)(\\addbibresource\{[^}]+\})/gm,
      '$1% $2  % Commented for submission - bibliography inlined'
    );
  } else {
    // For traditional BibTeX: replace \bibliography{...} with .bbl content
    const bibRegex = /\\bibliography\{[^}]+\}/g;

    if (bibRegex.test(result)) {
      result = result.replace(bibRegex, () => {
        replaced = true;
        return bblContent;
      });
    } else {
      warnings.push('No \\bibliography command found in document');
    }

    // Also comment out \bibliographystyle if present (style is now embedded in .bbl)
    // Actually, keep it - some journals want to see the style
  }

  return { content: result, replaced, warnings };
}

/**
 * Process bibliography for a flattened document
 *
 * 1. Find and read the .bbl file
 * 2. Replace bibliography commands with .bbl content
 */
export async function processBibliography(
  content: string,
  texPath: string
): Promise<{ content: string; bblInlined: boolean; warnings: string[] }> {
  const warnings: string[] = [];

  // Check if document has any bibliography commands
  const parsed = parseLatexDocument(content);
  if (parsed.bibliographyCommands.length === 0) {
    return { content, bblInlined: false, warnings: ['No bibliography commands found'] };
  }

  // Find and read the .bbl file
  const bblResult = await findAndReadBbl(texPath);

  if (!bblResult.found) {
    warnings.push(
      `.bbl file not found. Run LaTeX compilation first to generate it.`
    );
    return { content, bblInlined: false, warnings };
  }

  // Replace bibliography commands with .bbl content
  const replaceResult = replaceBibliographyWithBbl(content, bblResult.content);
  warnings.push(...replaceResult.warnings);

  if (!replaceResult.replaced) {
    warnings.push('Bibliography commands could not be replaced');
  }

  return {
    content: replaceResult.content,
    bblInlined: replaceResult.replaced,
    warnings,
  };
}
