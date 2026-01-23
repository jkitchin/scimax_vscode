/**
 * Shared file walking utilities
 * Used by both projectile and database indexing
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadIgnorePatterns, shouldIgnore, shouldIgnoreAbsolute } from './ignorePatterns';

/**
 * Options for file walking
 */
export interface FileWalkerOptions {
    /** Maximum directory depth to walk (default: 20) */
    maxDepth?: number;

    /** Maximum number of files to return (default: 5000) */
    maxFiles?: number;

    /** File extensions to include (e.g., ['.org', '.md']) - if empty, all files */
    extensions?: string[];

    /** Whether to include hidden files/directories (default: false) */
    includeHidden?: boolean;

    /** Base directory for loading .gitignore patterns (default: rootDir) */
    ignorePatternBase?: string;

    /** Additional ignore patterns to use */
    additionalIgnorePatterns?: string[];

    /** VS Code config-based exclude patterns (absolute paths or globs) */
    absoluteExcludePatterns?: string[];

    /** Progress callback */
    onProgress?: (filesFound: number) => void;

    /** Cancellation token */
    cancellationToken?: { cancelled: boolean };
}

/**
 * Result of file walking
 */
export interface FileWalkerResult {
    /** Files found */
    files: string[];

    /** Whether the walk was truncated due to limits */
    truncated: boolean;

    /** Whether the walk was cancelled */
    cancelled: boolean;
}

/**
 * Walk a directory recursively and find files
 * @param rootDir Directory to start walking from
 * @param options Walk options
 */
export async function walkDirectory(
    rootDir: string,
    options: FileWalkerOptions = {}
): Promise<FileWalkerResult> {
    const {
        maxDepth = 20,
        maxFiles = 5000,
        extensions = [],
        includeHidden = false,
        ignorePatternBase,
        additionalIgnorePatterns = [],
        absoluteExcludePatterns = [],
        onProgress,
        cancellationToken
    } = options;

    const files: string[] = [];
    let truncated = false;
    let cancelled = false;

    // Load ignore patterns from the base directory
    const patternBase = ignorePatternBase || rootDir;
    const ignorePatterns = loadIgnorePatterns(patternBase, true);
    const allPatterns = [...ignorePatterns, ...additionalIgnorePatterns];

    const walk = async (dir: string, depth: number): Promise<void> => {
        // Check cancellation
        if (cancellationToken?.cancelled) {
            cancelled = true;
            return;
        }

        // Check limits
        if (depth > maxDepth || files.length >= maxFiles) {
            if (files.length >= maxFiles) truncated = true;
            return;
        }

        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                // Check cancellation again
                if (cancellationToken?.cancelled) {
                    cancelled = true;
                    return;
                }

                // Check file limit
                if (files.length >= maxFiles) {
                    truncated = true;
                    return;
                }

                const fullPath = path.join(dir, entry.name);

                // Skip hidden files/dirs unless requested
                if (!includeHidden && entry.name.startsWith('.')) {
                    continue;
                }

                // Check absolute exclude patterns
                if (absoluteExcludePatterns.length > 0 &&
                    shouldIgnoreAbsolute(fullPath, absoluteExcludePatterns)) {
                    continue;
                }

                // Check relative ignore patterns
                const relativePath = path.relative(rootDir, fullPath);
                if (shouldIgnore(relativePath, allPatterns)) {
                    continue;
                }

                if (entry.isDirectory()) {
                    await walk(fullPath, depth + 1);
                } else if (entry.isFile()) {
                    // Check extension filter
                    if (extensions.length > 0) {
                        const ext = path.extname(entry.name).toLowerCase();
                        if (!extensions.includes(ext)) {
                            continue;
                        }
                    }

                    files.push(fullPath);

                    // Report progress every 100 files
                    if (onProgress && files.length % 100 === 0) {
                        onProgress(files.length);
                    }
                }
            }
        } catch (error) {
            // Ignore permission errors and other file system issues
        }
    };

    await walk(rootDir, 0);

    return { files, truncated, cancelled };
}

/**
 * Walk multiple directories and combine results
 * @param directories Array of directory paths
 * @param options Walk options
 */
export async function walkDirectories(
    directories: string[],
    options: FileWalkerOptions = {}
): Promise<FileWalkerResult> {
    const allFiles: string[] = [];
    let truncated = false;
    let cancelled = false;
    const seen = new Set<string>();

    const maxFiles = options.maxFiles || 5000;

    for (const dir of directories) {
        if (options.cancellationToken?.cancelled) {
            cancelled = true;
            break;
        }

        if (!fs.existsSync(dir)) {
            continue;
        }

        const remaining = maxFiles - allFiles.length;
        if (remaining <= 0) {
            truncated = true;
            break;
        }

        const result = await walkDirectory(dir, {
            ...options,
            maxFiles: remaining,
            onProgress: options.onProgress
                ? (count) => options.onProgress!(allFiles.length + count)
                : undefined
        });

        // Add files, deduplicating
        for (const file of result.files) {
            if (!seen.has(file)) {
                seen.add(file);
                allFiles.push(file);
            }
        }

        if (result.truncated) truncated = true;
        if (result.cancelled) {
            cancelled = true;
            break;
        }
    }

    return { files: allFiles, truncated, cancelled };
}

/**
 * Find org/md/ipynb files in directories (convenience function)
 */
export async function findOrgFiles(
    directories: string[],
    options: Omit<FileWalkerOptions, 'extensions'> = {}
): Promise<FileWalkerResult> {
    return walkDirectories(directories, {
        ...options,
        extensions: ['.org', '.md', '.ipynb']
    });
}

/**
 * Check if a directory appears to be a project root
 * (has .git, .projectile, package.json, etc.)
 */
export function isProjectRoot(dirPath: string): { isProject: boolean; type: 'git' | 'projectile' | 'npm' | 'unknown' } {
    try {
        const entries = fs.readdirSync(dirPath);

        if (entries.includes('.git')) {
            return { isProject: true, type: 'git' };
        }
        if (entries.includes('.projectile')) {
            return { isProject: true, type: 'projectile' };
        }
        if (entries.includes('package.json')) {
            return { isProject: true, type: 'npm' };
        }

        return { isProject: false, type: 'unknown' };
    } catch {
        return { isProject: false, type: 'unknown' };
    }
}

/**
 * Scan a directory tree for project roots
 */
export async function scanForProjects(
    rootDir: string,
    options: {
        maxDepth?: number;
        cancellationToken?: { cancelled: boolean };
    } = {}
): Promise<{ path: string; type: 'git' | 'projectile' | 'npm' }[]> {
    const { maxDepth = 3, cancellationToken } = options;
    const projects: { path: string; type: 'git' | 'projectile' | 'npm' }[] = [];
    const scannedDirs = new Set<string>();

    const scan = async (dir: string, depth: number): Promise<void> => {
        if (cancellationToken?.cancelled) return;
        if (depth > maxDepth || scannedDirs.has(dir)) return;
        scannedDirs.add(dir);

        const { isProject, type } = isProjectRoot(dir);
        if (isProject && type !== 'unknown') {
            projects.push({ path: dir, type });
            // Don't recurse into projects
            return;
        }

        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                if (cancellationToken?.cancelled) return;
                if (!entry.isDirectory()) continue;
                if (entry.name.startsWith('.')) continue;

                // Skip common non-project directories
                if (['node_modules', 'dist', 'build', 'out', '__pycache__', 'venv', '.venv'].includes(entry.name)) {
                    continue;
                }

                await scan(path.join(dir, entry.name), depth + 1);
            }
        } catch {
            // Ignore permission errors
        }
    };

    await scan(rootDir, 0);
    return projects;
}
