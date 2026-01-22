/**
 * Shared ignore pattern utilities
 * Used by both projectile and database indexing
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Default ignore patterns for common non-project directories/files
 */
export const DEFAULT_IGNORE_PATTERNS: string[] = [
    'node_modules',
    '__pycache__',
    '.git',
    '.svn',
    '.hg',
    'dist',
    'build',
    'out',
    '.vscode',
    '.idea',
    '*.pyc',
    '*.pyo',
    '*.class',
    '*.o',
    '*.so',
    '*.dylib',
    '.DS_Store',
    'Thumbs.db',
    'coverage',
    '.nyc_output',
    '.pytest_cache',
    '.tox',
    'venv',
    '.venv',
    'env',
    '.env',
    '*.egg-info',
    '.eggs',
    '.ipynb_checkpoints'
];

/**
 * Load ignore patterns from a directory (looks for .gitignore, etc.)
 * @param projectPath The directory to load patterns from
 * @param includeDefaults Whether to include default patterns (default: true)
 */
export function loadIgnorePatterns(
    projectPath: string,
    includeDefaults: boolean = true
): string[] {
    const patterns: string[] = includeDefaults ? [...DEFAULT_IGNORE_PATTERNS] : [];

    // Load .gitignore
    const gitignorePath = path.join(projectPath, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
        try {
            const content = fs.readFileSync(gitignorePath, 'utf-8');
            const gitPatterns = content.split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'));
            patterns.push(...gitPatterns);
        } catch {
            // Ignore read errors
        }
    }

    // Load .projectileignore (projectile-specific)
    const projectileIgnorePath = path.join(projectPath, '.projectileignore');
    if (fs.existsSync(projectileIgnorePath)) {
        try {
            const content = fs.readFileSync(projectileIgnorePath, 'utf-8');
            const projPatterns = content.split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'));
            patterns.push(...projPatterns);
        } catch {
            // Ignore read errors
        }
    }

    return patterns;
}

/**
 * Check if a relative path should be ignored based on patterns
 * @param relativePath Path relative to the project root
 * @param patterns Array of ignore patterns
 */
export function shouldIgnore(relativePath: string, patterns: string[]): boolean {
    const parts = relativePath.split(path.sep);

    for (const pattern of patterns) {
        // Clean up pattern - remove leading/trailing slashes
        const cleanPattern = pattern.replace(/^\//, '').replace(/\/$/, '');

        // Check if any path component matches
        if (parts.some(part => matchPattern(part, cleanPattern))) {
            return true;
        }

        // Check full path match for patterns with directory separators
        if (cleanPattern.includes('/') || cleanPattern.includes('**/')) {
            if (matchPattern(relativePath, cleanPattern)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Match a single pattern against a path component or full path
 * Supports simple wildcard patterns (* and **)
 */
function matchPattern(text: string, pattern: string): boolean {
    // Handle ** (matches any directory depth)
    if (pattern.includes('**')) {
        const regex = new RegExp(
            '^' +
            pattern
                .replace(/\*\*/g, '<<<GLOBSTAR>>>')
                .replace(/\*/g, '[^/]*')
                .replace(/<<<GLOBSTAR>>>/g, '.*')
                .replace(/\//g, '\\/') +
            '$'
        );
        return regex.test(text);
    }

    // Handle simple wildcards
    if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(text);
    }

    // Exact match
    return text === pattern;
}

/**
 * Check if an absolute path should be ignored
 * Useful for VS Code configuration-based exclude patterns
 * @param absolutePath Absolute file path
 * @param patterns Array of patterns (can be globs or absolute paths)
 */
export function shouldIgnoreAbsolute(absolutePath: string, patterns: string[]): boolean {
    const { minimatch } = require('minimatch');

    for (const pattern of patterns) {
        // Expand ~ in pattern
        let expandedPattern = pattern;
        if (pattern.startsWith('~')) {
            expandedPattern = pattern.replace(/^~/, process.env.HOME || '');
        }

        if (pattern.includes('*')) {
            // It's a glob pattern
            if (minimatch(absolutePath, expandedPattern, { matchBase: true })) {
                return true;
            }
        } else {
            // It's an absolute path or directory name
            if (absolutePath === expandedPattern || absolutePath.startsWith(expandedPattern + path.sep)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Combine multiple pattern arrays, deduplicating
 */
export function mergePatterns(...patternArrays: string[][]): string[] {
    const combined = new Set<string>();
    for (const patterns of patternArrays) {
        for (const pattern of patterns) {
            combined.add(pattern);
        }
    }
    return Array.from(combined);
}
