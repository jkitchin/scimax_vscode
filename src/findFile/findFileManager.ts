/**
 * Find File Manager
 * Core state management and file operations for find-file
 *
 * SECURITY: All file operations validate paths to prevent path traversal attacks.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    FindFileEntry,
    FindFileState,
    OriginalPosition
} from './findFileTypes';

/**
 * Validate that a resolved path is within the expected parent directory
 */
function isPathWithinDirectory(resolvedPath: string, expectedParent: string): boolean {
    const normalizedResolved = path.normalize(resolvedPath);
    const normalizedParent = path.normalize(expectedParent);

    // Handle root directory specially
    if (normalizedParent === '/') {
        return normalizedResolved.startsWith('/');
    }

    return normalizedResolved.startsWith(normalizedParent + path.sep) ||
           normalizedResolved === normalizedParent;
}

export class FindFileManager {
    private state: FindFileState;
    private onStateChangeCallbacks: ((state: FindFileState) => void)[] = [];
    private originalPosition: OriginalPosition | null = null;

    constructor(initialDirectory?: string, originalPosition?: OriginalPosition | null) {
        const startDir = initialDirectory ||
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
            process.env.HOME ||
            '/';

        this.state = {
            currentDirectory: startDir,
            entries: [],
            filteredEntries: [],
            selectedIndex: 0,
            filterText: '',
            showHidden: false
        };

        this.originalPosition = originalPosition || null;
    }

    /**
     * Get the current state
     */
    getState(): FindFileState {
        return this.state;
    }

    /**
     * Get the original cursor position
     */
    getOriginalPosition(): OriginalPosition | null {
        return this.originalPosition;
    }

    /**
     * Register a callback for state changes
     */
    onStateChange(callback: (state: FindFileState) => void): void {
        this.onStateChangeCallbacks.push(callback);
    }

    /**
     * Notify all listeners of state change
     */
    private notifyStateChange(): void {
        for (const callback of this.onStateChangeCallbacks) {
            callback(this.state);
        }
    }

    /**
     * Load entries from a directory
     */
    async loadDirectory(directory?: string): Promise<void> {
        const dir = directory || this.state.currentDirectory;

        try {
            // Normalize path
            const normalizedDir = path.resolve(dir);

            // Check directory exists and is accessible
            const stats = await fs.promises.stat(normalizedDir);
            if (!stats.isDirectory()) {
                throw new Error(`${normalizedDir} is not a directory`);
            }

            // Read directory entries
            const entries = await fs.promises.readdir(normalizedDir, { withFileTypes: true });
            const fileEntries: FindFileEntry[] = [];

            // Add ".." entry for navigation to parent (except at root)
            const parentDir = path.dirname(normalizedDir);
            if (parentDir !== normalizedDir) {
                fileEntries.push({
                    name: '..',
                    path: parentDir,
                    isDirectory: true,
                    size: 0,
                    mtime: new Date()
                });
            }

            for (const entry of entries) {
                // Skip hidden files if not showing them
                if (!this.state.showHidden && entry.name.startsWith('.')) {
                    continue;
                }

                const fullPath = path.join(normalizedDir, entry.name);

                // Verify the path is within the directory (paranoid check)
                if (!isPathWithinDirectory(fullPath, normalizedDir)) {
                    console.warn(`FindFile: Skipping suspicious path ${fullPath}`);
                    continue;
                }

                try {
                    const stat = await fs.promises.lstat(fullPath);
                    const isDir = entry.isDirectory() || (stat.isSymbolicLink() &&
                        await this.isSymlinkToDirectory(fullPath));

                    fileEntries.push({
                        name: entry.name,
                        path: fullPath,
                        isDirectory: isDir,
                        size: stat.size,
                        mtime: stat.mtime
                    });
                } catch (error) {
                    // Skip files we can't stat
                    console.warn(`FindFile: Could not stat ${fullPath}:`, error);
                }
            }

            // Sort: directories first (except ..), then alphabetically
            fileEntries.sort((a, b) => {
                // ".." always first
                if (a.name === '..') return -1;
                if (b.name === '..') return 1;

                // Directories before files
                if (a.isDirectory && !b.isDirectory) return -1;
                if (!a.isDirectory && b.isDirectory) return 1;

                // Alphabetical (case-insensitive)
                return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
            });

            // Update state
            this.state.currentDirectory = normalizedDir;
            this.state.entries = fileEntries;
            this.state.filterText = '';
            this.state.selectedIndex = 0;

            // Apply filter (which will set filteredEntries)
            this.applyFilter();

            this.notifyStateChange();
        } catch (error: any) {
            throw new Error(`Failed to load directory ${dir}: ${error.message}`);
        }
    }

    /**
     * Check if a symlink points to a directory
     */
    private async isSymlinkToDirectory(linkPath: string): Promise<boolean> {
        try {
            const realPath = await fs.promises.realpath(linkPath);
            const stat = await fs.promises.stat(realPath);
            return stat.isDirectory();
        } catch {
            return false;
        }
    }

    /**
     * Apply the current filter to entries
     */
    private applyFilter(): void {
        const filter = this.state.filterText.toLowerCase();

        if (filter === '') {
            this.state.filteredEntries = [...this.state.entries];
        } else {
            this.state.filteredEntries = this.state.entries.filter(entry => {
                // Always include ".."
                if (entry.name === '..') return true;
                // Fuzzy match: check if filter characters appear in order
                return this.fuzzyMatch(entry.name.toLowerCase(), filter);
            });
        }

        // Reset selection if out of bounds
        if (this.state.selectedIndex >= this.state.filteredEntries.length) {
            this.state.selectedIndex = Math.max(0, this.state.filteredEntries.length - 1);
        }
    }

    /**
     * Fuzzy match: check if pattern characters appear in order in text
     */
    private fuzzyMatch(text: string, pattern: string): boolean {
        let patternIndex = 0;
        for (let i = 0; i < text.length && patternIndex < pattern.length; i++) {
            if (text[i] === pattern[patternIndex]) {
                patternIndex++;
            }
        }
        return patternIndex === pattern.length;
    }

    /**
     * Set filter text
     */
    setFilter(text: string): void {
        this.state.filterText = text;
        this.applyFilter();
        this.notifyStateChange();
    }

    /**
     * Add character to filter
     */
    addToFilter(char: string): void {
        this.state.filterText += char;
        this.applyFilter();
        this.notifyStateChange();
    }

    /**
     * Remove last character from filter
     */
    backspaceFilter(): void {
        if (this.state.filterText.length > 0) {
            this.state.filterText = this.state.filterText.slice(0, -1);
            this.applyFilter();
            this.notifyStateChange();
        }
    }

    /**
     * Clear filter
     */
    clearFilter(): void {
        this.state.filterText = '';
        this.applyFilter();
        this.notifyStateChange();
    }

    /**
     * Navigate to parent directory
     */
    async navigateToParent(): Promise<void> {
        const parent = path.dirname(this.state.currentDirectory);
        if (parent !== this.state.currentDirectory) {
            const currentDirName = path.basename(this.state.currentDirectory);
            await this.loadDirectory(parent);
            // Try to select the directory we came from
            const index = this.state.filteredEntries.findIndex(e => e.name === currentDirName);
            if (index >= 0) {
                this.state.selectedIndex = index;
                this.notifyStateChange();
            }
        }
    }

    /**
     * Navigate into the selected directory
     */
    async navigateIntoSelected(): Promise<boolean> {
        const selected = this.state.filteredEntries[this.state.selectedIndex];
        if (!selected) return false;

        if (selected.isDirectory) {
            await this.loadDirectory(selected.path);
            return true;
        }
        return false;
    }

    /**
     * Get the currently selected entry
     */
    getSelectedEntry(): FindFileEntry | null {
        return this.state.filteredEntries[this.state.selectedIndex] || null;
    }

    /**
     * Move selection
     */
    moveSelection(delta: number): void {
        const newIndex = Math.max(0, Math.min(
            this.state.filteredEntries.length - 1,
            this.state.selectedIndex + delta
        ));
        if (newIndex !== this.state.selectedIndex) {
            this.state.selectedIndex = newIndex;
            this.notifyStateChange();
        }
    }

    selectFirst(): void {
        if (this.state.filteredEntries.length > 0) {
            this.state.selectedIndex = 0;
            this.notifyStateChange();
        }
    }

    selectLast(): void {
        if (this.state.filteredEntries.length > 0) {
            this.state.selectedIndex = this.state.filteredEntries.length - 1;
            this.notifyStateChange();
        }
    }

    /**
     * Toggle hidden files visibility
     */
    toggleHidden(): void {
        this.state.showHidden = !this.state.showHidden;
        this.loadDirectory();
    }

    /**
     * Get relative path from original file to target
     */
    getRelativePath(targetPath: string): string {
        if (!this.originalPosition) {
            return targetPath;
        }
        const fromDir = path.dirname(this.originalPosition.uri.fsPath);
        return path.relative(fromDir, targetPath);
    }

    /**
     * Format path as org-mode link
     */
    formatOrgLink(targetPath: string, relative: boolean): string {
        const linkPath = relative ? this.getRelativePath(targetPath) : targetPath;
        const fileName = path.basename(targetPath);
        return `[[file:${linkPath}][${fileName}]]`;
    }
}
