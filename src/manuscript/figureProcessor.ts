/**
 * Figure Processor for LaTeX manuscripts
 *
 * Renames figures sequentially and updates paths in the document
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { FigureMapping, FigureCommand, ProcessedFigures } from './types';
import { parseLatexDocument } from './latexParser';

/**
 * Figure file extensions that LaTeX can use, in search order
 */
const FIGURE_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.eps', '.ps', '.svg'];

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
 * Resolve the actual path to a figure file
 *
 * LaTeX can omit the extension in \includegraphics, so we need to search.
 * Also handles paths that may have been relative to included files by
 * trying multiple base directories.
 */
async function resolveFigurePath(
  figurePath: string,
  rootDir: string
): Promise<{ resolvedPath: string; extension: string } | null> {
  // If the path already has an extension, just check if it exists
  const hasExtension = FIGURE_EXTENSIONS.some(ext =>
    figurePath.toLowerCase().endsWith(ext)
  );

  // Normalize the path - handle ../ by trying to resolve it
  // Also try common figure directories if direct path fails
  const pathsToTry: string[] = [
    figurePath,
  ];

  // If path has ../, also try without it (in case it was from a subdirectory)
  if (figurePath.includes('../')) {
    // Extract just the filename and try common locations
    const basename = path.basename(figurePath);
    pathsToTry.push(basename);
    pathsToTry.push(`figures/${basename}`);
    pathsToTry.push(`images/${basename}`);
    pathsToTry.push(`fig/${basename}`);

    // Also try resolving the ../ from the root
    const normalized = path.normalize(figurePath);
    if (normalized !== figurePath) {
      pathsToTry.push(normalized);
    }
  }

  for (const tryPath of pathsToTry) {
    if (hasExtension) {
      const fullPath = path.resolve(rootDir, tryPath);
      if (await fileExists(fullPath)) {
        const ext = path.extname(tryPath).toLowerCase();
        return { resolvedPath: fullPath, extension: ext };
      }
    } else {
      // No extension - search in order of preference
      for (const ext of FIGURE_EXTENSIONS) {
        const fullPath = path.resolve(rootDir, `${tryPath}${ext}`);
        if (await fileExists(fullPath)) {
          return { resolvedPath: fullPath, extension: ext };
        }
      }
    }
  }

  return null;
}

/**
 * Calculate the padding width based on total figure count
 */
function getPaddingWidth(totalCount: number): number {
  if (totalCount < 10) return 1;      // 1-9: "1.png"
  if (totalCount < 100) return 2;     // 10-99: "01.png"
  if (totalCount < 1000) return 3;    // 100-999: "001.png"
  return 4;                            // 1000+: unlikely but handled
}

/**
 * Format a figure number with appropriate padding
 */
function formatFigureNumber(index: number, totalCount: number): string {
  const width = getPaddingWidth(totalCount);
  return String(index + 1).padStart(width, '0');
}

/**
 * Process figures in a LaTeX document
 *
 * 1. Find all \includegraphics commands
 * 2. Resolve actual file paths
 * 3. Generate sequential names (1.pdf, 2.png, etc.)
 * 4. Update paths in document content
 */
export async function processFigures(
  content: string,
  rootDir: string
): Promise<ProcessedFigures & { warnings: string[] }> {
  const warnings: string[] = [];
  const mappings: FigureMapping[] = [];

  // Parse to find all figure commands
  const parsed = parseLatexDocument(content);
  const figureCommands = parsed.figureCommands;

  if (figureCommands.length === 0) {
    return { mappings: [], updatedContent: content, warnings };
  }

  // First pass: resolve all figure paths and build mappings
  const resolvedFigures: Array<{
    cmd: FigureCommand;
    resolved: { resolvedPath: string; extension: string } | null;
  }> = [];

  // Use a Map to track unique figures (same source file should get same new name)
  const uniqueFigures = new Map<string, FigureMapping>();

  for (const cmd of figureCommands) {
    const resolved = await resolveFigurePath(cmd.path, rootDir);
    resolvedFigures.push({ cmd, resolved });

    if (!resolved) {
      warnings.push(`Could not find figure: ${cmd.path}`);
      continue;
    }

    // Check if we've already seen this exact file
    if (!uniqueFigures.has(resolved.resolvedPath)) {
      const figureIndex = uniqueFigures.size;
      const newName = `${formatFigureNumber(figureIndex, figureCommands.length)}${resolved.extension}`;

      uniqueFigures.set(resolved.resolvedPath, {
        originalPath: cmd.path,
        newName,
        resolvedSource: resolved.resolvedPath,
        extension: resolved.extension,
      });
    }
  }

  // Build the final mappings array
  mappings.push(...uniqueFigures.values());

  // Second pass: replace paths in content (from end to start to preserve positions)
  let result = content;
  const sortedFigures = [...resolvedFigures].sort(
    (a, b) => b.cmd.position.start - a.cmd.position.start
  );

  for (const { cmd, resolved } of sortedFigures) {
    if (!resolved) {
      continue; // Skip unresolved figures
    }

    const mapping = uniqueFigures.get(resolved.resolvedPath);
    if (!mapping) {
      continue;
    }

    // Build the new \includegraphics command
    const options = cmd.options ? `[${cmd.options}]` : '';
    const newCommand = `\\includegraphics${options}{${mapping.newName}}`;

    // Replace in content
    result =
      result.slice(0, cmd.position.start) +
      newCommand +
      result.slice(cmd.position.end);
  }

  return { mappings, updatedContent: result, warnings };
}

/**
 * Copy figures to the output directory with new names
 */
export async function copyFigures(
  mappings: FigureMapping[],
  outputDir: string
): Promise<{ copied: string[]; errors: string[] }> {
  const copied: string[] = [];
  const errors: string[] = [];

  for (const mapping of mappings) {
    const destPath = path.join(outputDir, mapping.newName);

    try {
      await fs.copyFile(mapping.resolvedSource, destPath);
      copied.push(mapping.newName);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to copy ${mapping.originalPath}: ${message}`);
    }
  }

  return { copied, errors };
}
