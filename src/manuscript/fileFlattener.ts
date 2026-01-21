/**
 * File Flattener for LaTeX manuscripts
 *
 * Recursively resolves and inlines \input{} and \include{} commands
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { parseLatexDocument } from './latexParser';
import { InputCommand } from './types';

/**
 * Options for flattening
 */
interface FlattenIncludes {
  /** Root directory of the manuscript */
  rootDir: string;
  /** Maximum recursion depth (default: 20) */
  maxDepth?: number;
}

/**
 * Result of flattening includes
 */
export interface FlattenIncludesResult {
  /** The flattened content */
  content: string;
  /** Warning messages */
  warnings: string[];
  /** Files that were included */
  includedFiles: string[];
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
 * Resolve the path to an included file
 *
 * LaTeX automatically adds .tex extension if not present
 */
async function resolveIncludePath(
  includePath: string,
  currentFileDir: string,
  rootDir: string
): Promise<string | null> {
  // Paths to try, in order
  const candidates: string[] = [];

  // First, try relative to current file
  candidates.push(path.resolve(currentFileDir, includePath));
  if (!includePath.endsWith('.tex')) {
    candidates.push(path.resolve(currentFileDir, `${includePath}.tex`));
  }

  // Then, try relative to root directory
  candidates.push(path.resolve(rootDir, includePath));
  if (!includePath.endsWith('.tex')) {
    candidates.push(path.resolve(rootDir, `${includePath}.tex`));
  }

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Flatten all \input and \include commands in a LaTeX file
 *
 * Recursively processes included files up to maxDepth levels
 */
export async function flattenIncludes(
  content: string,
  currentFile: string,
  options: FlattenIncludes,
  depth: number = 0,
  visitedFiles: Set<string> = new Set()
): Promise<FlattenIncludesResult> {
  const { rootDir, maxDepth = 20 } = options;
  const warnings: string[] = [];
  const includedFiles: string[] = [];

  // Prevent infinite recursion
  if (depth > maxDepth) {
    warnings.push(`Maximum include depth (${maxDepth}) exceeded`);
    return { content, warnings, includedFiles };
  }

  // Track visited files to detect cycles
  const currentFileResolved = path.resolve(currentFile);
  if (visitedFiles.has(currentFileResolved)) {
    warnings.push(`Circular include detected: ${currentFile}`);
    return { content, warnings, includedFiles };
  }
  visitedFiles.add(currentFileResolved);

  // Parse the document to find input commands
  const parsed = parseLatexDocument(content);
  const currentFileDir = path.dirname(currentFile);

  // Process includes from end to start (to preserve positions)
  const commands = [...parsed.inputCommands].sort(
    (a, b) => b.position.start - a.position.start
  );

  let result = content;

  for (const cmd of commands) {
    const resolvedPath = await resolveIncludePath(cmd.path, currentFileDir, rootDir);

    if (!resolvedPath) {
      warnings.push(`Could not find included file: ${cmd.path} (from ${currentFile})`);
      continue;
    }

    try {
      let includedContent = await fs.readFile(resolvedPath, 'utf-8');
      includedFiles.push(resolvedPath);

      // Recursively flatten the included file
      const nestedResult = await flattenIncludes(
        includedContent,
        resolvedPath,
        options,
        depth + 1,
        visitedFiles
      );

      includedContent = nestedResult.content;
      warnings.push(...nestedResult.warnings);
      includedFiles.push(...nestedResult.includedFiles);

      // For \include{}, LaTeX adds \clearpage before and after
      if (cmd.command === 'include') {
        includedContent = `\\clearpage\n${includedContent}\n\\clearpage`;
      }

      // Replace the command with the file content
      result =
        result.slice(0, cmd.position.start) +
        includedContent +
        result.slice(cmd.position.end);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`Error reading ${resolvedPath}: ${message}`);
    }
  }

  return { content: result, warnings, includedFiles };
}

/**
 * Convenience function to flatten a LaTeX file by path
 */
export async function flattenLatexFile(
  texPath: string,
  maxDepth: number = 20
): Promise<FlattenIncludesResult> {
  const content = await fs.readFile(texPath, 'utf-8');
  const rootDir = path.dirname(texPath);

  return flattenIncludes(content, texPath, { rootDir, maxDepth });
}
