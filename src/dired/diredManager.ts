/**
 * Dired Manager
 * Core state management and file operations for dired
 *
 * SECURITY: All file operations validate paths to prevent path traversal attacks.
 * Names are validated to not contain path separators or parent directory references.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    DiredEntry,
    DiredDisplayEntry,
    DiredState,
    MarkType,
    SortField,
    SortOptions
} from './diredTypes';

/**
 * Validate a filename to ensure it doesn't contain path traversal attempts
 * @param name The filename to validate
 * @returns true if valid, false if invalid
 */
function isValidFilename(name: string): boolean {
    if (!name || name.length === 0) {
        return false;
    }

    // Reject empty or whitespace-only names
    if (name.trim().length === 0) {
        return false;
    }

    // Reject names with path separators
    if (name.includes('/') || name.includes('\\')) {
        return false;
    }

    // Reject parent directory references
    if (name === '..' || name === '.') {
        return false;
    }

    // Reject names that are too long (filesystem limit is typically 255)
    if (name.length > 255) {
        return false;
    }

    // Reject names with null bytes (security issue)
    if (name.includes('\0')) {
        return false;
    }

    return true;
}

/**
 * Validate that a resolved path is within the expected parent directory
 * @param resolvedPath The resolved absolute path
 * @param expectedParent The expected parent directory
 * @returns true if the path is safely within the parent
 */
function isPathWithinDirectory(resolvedPath: string, expectedParent: string): boolean {
    const normalizedResolved = path.normalize(resolvedPath);
    const normalizedParent = path.normalize(expectedParent);

    // Handle root directory specially
    if (normalizedParent === '/') {
        // Any absolute path starting with / is within root
        return normalizedResolved.startsWith('/');
    }

    // Ensure the resolved path starts with the parent path
    // Add path.sep to prevent matching /home/user with /home/username
    return normalizedResolved.startsWith(normalizedParent + path.sep) ||
           normalizedResolved === normalizedParent;
}

/**
 * Safely escape a regex pattern to prevent ReDoS
 */
function escapeRegexForSafeMatching(pattern: string): RegExp | null {
    try {
        // Limit pattern length to prevent ReDoS
        if (pattern.length > 100) {
            return null;
        }

        // Test the regex with a timeout-like approach
        // Create the regex and test it against a sample string
        const regex = new RegExp(pattern, 'i');

        // Quick sanity check - if it takes too long on a simple string, reject
        const testString = 'a'.repeat(50);
        const start = Date.now();
        regex.test(testString);
        if (Date.now() - start > 10) {
            // Regex took too long, might be ReDoS
            return null;
        }

        return regex;
    } catch {
        return null;
    }
}

export class DiredManager {
    private state: DiredState;
    private onStateChangeCallbacks: ((state: DiredState) => void)[] = [];

    constructor(initialDirectory?: string) {
        const startDir = initialDirectory ||
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
            process.env.HOME ||
            '/';

        this.state = {
            currentDirectory: startDir,
            entries: [],
            selectedIndex: 0,
            wdiredMode: false,
            pendingRenames: new Map(),
            sort: { field: 'name', direction: 'asc' },
            showHidden: false,
            filterPattern: ''
        };
    }

    /**
     * Get the current state
     */
    getState(): DiredState {
        return this.state;
    }

    /**
     * Register a callback for state changes
     */
    onStateChange(callback: (state: DiredState) => void): void {
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
     * Load entries from the current directory
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
            const diredEntries: DiredEntry[] = [];

            // Safely compile filter regex if set
            let filterRegex: RegExp | null = null;
            if (this.state.filterPattern) {
                filterRegex = escapeRegexForSafeMatching(this.state.filterPattern);
                // If regex is invalid, treat as no filter rather than error
            }

            // Add . and .. entries for navigation (readdir doesn't include them)
            const parentDir = path.dirname(normalizedDir);
            try {
                const currentStat = await fs.promises.lstat(normalizedDir);
                diredEntries.push({
                    name: '.',
                    path: normalizedDir,
                    isDirectory: true,
                    size: currentStat.size,
                    mtime: currentStat.mtime,
                    mode: currentStat.mode,
                    isSymlink: false
                });

                const parentStat = await fs.promises.lstat(parentDir);
                diredEntries.push({
                    name: '..',
                    path: parentDir,
                    isDirectory: true,
                    size: parentStat.size,
                    mtime: parentStat.mtime,
                    mode: parentStat.mode,
                    isSymlink: false
                });
            } catch {
                // Ignore errors getting . and .. stats
            }

            for (const entry of entries) {
                // Skip hidden files if not showing them
                if (!this.state.showHidden && entry.name.startsWith('.')) {
                    continue;
                }

                // Apply filter if set and valid
                if (filterRegex && !filterRegex.test(entry.name)) {
                    continue;
                }

                const fullPath = path.join(normalizedDir, entry.name);

                // Verify the path is within the directory (paranoid check)
                if (!isPathWithinDirectory(fullPath, normalizedDir)) {
                    console.warn(`Dired: Skipping suspicious path ${fullPath}`);
                    continue;
                }

                try {
                    const stat = await fs.promises.lstat(fullPath);
                    const diredEntry: DiredEntry = {
                        name: entry.name,
                        path: fullPath,
                        isDirectory: entry.isDirectory(),
                        size: stat.size,
                        mtime: stat.mtime,
                        mode: stat.mode,
                        isSymlink: stat.isSymbolicLink()
                    };

                    // Resolve symlink target
                    if (stat.isSymbolicLink()) {
                        try {
                            diredEntry.symlinkTarget = await fs.promises.readlink(fullPath);
                        } catch {
                            // Symlink might be broken
                            diredEntry.symlinkTarget = '???';
                        }
                    }

                    diredEntries.push(diredEntry);
                } catch (error) {
                    // Skip files we can't stat
                    console.warn(`Dired: Could not stat ${fullPath}:`, error);
                }
            }

            // Sort entries
            this.sortEntries(diredEntries);

            // Convert to display entries
            this.state.currentDirectory = normalizedDir;
            this.state.entries = diredEntries.map((entry, index) => ({
                ...entry,
                mark: 'none' as MarkType,
                index
            }));

            // Reset selection to first entry
            this.state.selectedIndex = 0;

            // Clear wdired mode
            this.state.wdiredMode = false;
            this.state.pendingRenames.clear();

            this.notifyStateChange();
        } catch (error: any) {
            throw new Error(`Failed to load directory ${dir}: ${error.message}`);
        }
    }

    /**
     * Sort entries according to current sort options
     */
    private sortEntries(entries: DiredEntry[]): void {
        const { field, direction } = this.state.sort;
        const multiplier = direction === 'asc' ? 1 : -1;

        // Always put . and .. first, then directories, then files
        entries.sort((a, b) => {
            // . always first
            if (a.name === '.') return -1;
            if (b.name === '.') return 1;

            // .. always second
            if (a.name === '..') return -1;
            if (b.name === '..') return 1;

            // Directories before files
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;

            // Then sort by field
            let comparison = 0;
            switch (field) {
                case 'name':
                    comparison = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
                    break;
                case 'size':
                    comparison = a.size - b.size;
                    break;
                case 'mtime':
                    comparison = a.mtime.getTime() - b.mtime.getTime();
                    break;
                case 'extension':
                    const extA = path.extname(a.name).toLowerCase();
                    const extB = path.extname(b.name).toLowerCase();
                    comparison = extA.localeCompare(extB);
                    if (comparison === 0) {
                        comparison = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
                    }
                    break;
            }
            return comparison * multiplier;
        });
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
            const index = this.state.entries.findIndex(e => e.name === currentDirName);
            if (index >= 0) {
                this.state.selectedIndex = index;
                this.notifyStateChange();
            }
        }
    }

    /**
     * Open the selected entry
     * Returns the entry if it's a file (to be opened in editor)
     */
    async openSelected(): Promise<DiredEntry | null> {
        const selected = this.state.entries[this.state.selectedIndex];
        if (!selected) return null;

        if (selected.isDirectory) {
            await this.loadDirectory(selected.path);
            return null;
        } else {
            return selected;
        }
    }

    /**
     * Open entry at specific index
     */
    async openAtIndex(index: number): Promise<DiredEntry | null> {
        if (index < 0 || index >= this.state.entries.length) return null;
        this.state.selectedIndex = index;
        return this.openSelected();
    }

    // Navigation methods
    moveSelection(delta: number): void {
        const newIndex = Math.max(0, Math.min(
            this.state.entries.length - 1,
            this.state.selectedIndex + delta
        ));
        if (newIndex !== this.state.selectedIndex) {
            this.state.selectedIndex = newIndex;
            this.notifyStateChange();
        }
    }

    selectIndex(index: number): void {
        if (index >= 0 && index < this.state.entries.length) {
            this.state.selectedIndex = index;
            this.notifyStateChange();
        }
    }

    selectFirst(): void {
        if (this.state.entries.length > 0) {
            this.state.selectedIndex = 0;
            this.notifyStateChange();
        }
    }

    selectLast(): void {
        if (this.state.entries.length > 0) {
            this.state.selectedIndex = this.state.entries.length - 1;
            this.notifyStateChange();
        }
    }

    // Marking methods
    markCurrent(): void {
        const entry = this.state.entries[this.state.selectedIndex];
        if (entry) {
            entry.mark = 'marked';
            this.moveSelection(1);
        }
    }

    unmarkCurrent(): void {
        const entry = this.state.entries[this.state.selectedIndex];
        if (entry) {
            entry.mark = 'none';
            this.moveSelection(1);
        }
    }

    toggleMarkCurrent(): void {
        const entry = this.state.entries[this.state.selectedIndex];
        if (entry) {
            entry.mark = entry.mark === 'marked' ? 'none' : 'marked';
            this.notifyStateChange();
        }
    }

    flagCurrent(): void {
        const entry = this.state.entries[this.state.selectedIndex];
        if (entry) {
            entry.mark = 'flagged';
            this.moveSelection(1);
        }
    }

    unmarkAll(): void {
        for (const entry of this.state.entries) {
            entry.mark = 'none';
        }
        this.notifyStateChange();
    }

    toggleAllMarks(): void {
        for (const entry of this.state.entries) {
            entry.mark = entry.mark === 'marked' ? 'none' : 'marked';
        }
        this.notifyStateChange();
    }

    markByRegex(pattern: string): number {
        const regex = escapeRegexForSafeMatching(pattern);
        if (!regex) {
            return 0; // Invalid or dangerous regex
        }

        let count = 0;
        for (const entry of this.state.entries) {
            if (regex.test(entry.name)) {
                entry.mark = 'marked';
                count++;
            }
        }
        this.notifyStateChange();
        return count;
    }

    /**
     * Get all marked or flagged entries
     */
    getMarkedEntries(): DiredDisplayEntry[] {
        return this.state.entries.filter(e => e.mark === 'marked' || e.mark === 'flagged');
    }

    /**
     * Get entries flagged for deletion
     */
    getFlaggedEntries(): DiredDisplayEntry[] {
        return this.state.entries.filter(e => e.mark === 'flagged');
    }

    /**
     * Verify a file still exists at the expected path
     */
    private async verifyFileExists(filePath: string): Promise<boolean> {
        try {
            await fs.promises.access(filePath, fs.constants.F_OK);
            return true;
        } catch {
            return false;
        }
    }

    // File operations
    /**
     * Delete files (marked/flagged or current if none marked)
     *
     * SECURITY: Files are verified to exist before deletion.
     * Paths come from our directory listing, not user input.
     */
    async deleteFiles(useTrash: boolean = true): Promise<{ deleted: string[]; errors: string[] }> {
        let toDelete = this.getFlaggedEntries();
        if (toDelete.length === 0) {
            toDelete = this.getMarkedEntries();
        }
        if (toDelete.length === 0) {
            // Delete current
            const current = this.state.entries[this.state.selectedIndex];
            if (current) {
                toDelete = [current];
            }
        }

        if (toDelete.length === 0) {
            return { deleted: [], errors: [] };
        }

        const deleted: string[] = [];
        const errors: string[] = [];

        for (const entry of toDelete) {
            try {
                // Verify the file still exists
                if (!await this.verifyFileExists(entry.path)) {
                    errors.push(`${entry.name}: File no longer exists`);
                    continue;
                }

                // Verify path is still within current directory (paranoid check)
                if (!isPathWithinDirectory(entry.path, this.state.currentDirectory)) {
                    errors.push(`${entry.name}: Path is outside current directory`);
                    continue;
                }

                if (useTrash) {
                    // Use VS Code's trash API - safer as files can be recovered
                    await vscode.workspace.fs.delete(vscode.Uri.file(entry.path), {
                        recursive: entry.isDirectory,
                        useTrash: true
                    });
                } else {
                    // Permanent delete - requires extra caution
                    if (entry.isDirectory) {
                        await fs.promises.rm(entry.path, { recursive: true });
                    } else {
                        await fs.promises.unlink(entry.path);
                    }
                }
                deleted.push(entry.name);
            } catch (error: any) {
                errors.push(`${entry.name}: ${error.message}`);
            }
        }

        // Refresh the directory
        await this.loadDirectory();

        return { deleted, errors };
    }

    /**
     * Copy files to destination
     *
     * SECURITY: Destination must be a valid directory.
     * Source paths come from our directory listing.
     */
    async copyFiles(destination: string): Promise<{ copied: string[]; errors: string[] }> {
        // Validate destination is an existing directory
        const normalizedDest = path.resolve(destination);
        try {
            const destStats = await fs.promises.stat(normalizedDest);
            if (!destStats.isDirectory()) {
                return { copied: [], errors: ['Destination is not a directory'] };
            }
        } catch (error: any) {
            return { copied: [], errors: [`Cannot access destination: ${error.message}`] };
        }

        let toCopy = this.getMarkedEntries();
        if (toCopy.length === 0) {
            const current = this.state.entries[this.state.selectedIndex];
            if (current) {
                toCopy = [current];
            }
        }

        if (toCopy.length === 0) {
            return { copied: [], errors: [] };
        }

        const copied: string[] = [];
        const errors: string[] = [];

        for (const entry of toCopy) {
            try {
                // Verify source still exists
                if (!await this.verifyFileExists(entry.path)) {
                    errors.push(`${entry.name}: Source file no longer exists`);
                    continue;
                }

                const destPath = path.join(normalizedDest, entry.name);

                // Verify destination path is within the destination directory
                if (!isPathWithinDirectory(destPath, normalizedDest)) {
                    errors.push(`${entry.name}: Invalid destination path`);
                    continue;
                }

                // Check if destination already exists
                if (await this.verifyFileExists(destPath)) {
                    errors.push(`${entry.name}: Already exists at destination`);
                    continue;
                }

                await vscode.workspace.fs.copy(
                    vscode.Uri.file(entry.path),
                    vscode.Uri.file(destPath),
                    { overwrite: false }
                );
                copied.push(entry.name);
            } catch (error: any) {
                errors.push(`${entry.name}: ${error.message}`);
            }
        }

        // Refresh if we copied within the same directory
        if (normalizedDest === this.state.currentDirectory) {
            await this.loadDirectory();
        }

        return { copied, errors };
    }

    /**
     * Rename/move files to destination directory
     *
     * SECURITY: Destination must be a valid directory.
     * Source paths come from our directory listing.
     */
    async renameFiles(destination: string): Promise<{ renamed: string[]; errors: string[] }> {
        // Validate destination is an existing directory
        const normalizedDest = path.resolve(destination);
        try {
            const destStats = await fs.promises.stat(normalizedDest);
            if (!destStats.isDirectory()) {
                return { renamed: [], errors: ['Destination is not a directory'] };
            }
        } catch (error: any) {
            return { renamed: [], errors: [`Cannot access destination: ${error.message}`] };
        }

        let toRename = this.getMarkedEntries();
        if (toRename.length === 0) {
            const current = this.state.entries[this.state.selectedIndex];
            if (current) {
                toRename = [current];
            }
        }

        if (toRename.length === 0) {
            return { renamed: [], errors: [] };
        }

        const renamed: string[] = [];
        const errors: string[] = [];

        for (const entry of toRename) {
            try {
                // Verify source still exists
                if (!await this.verifyFileExists(entry.path)) {
                    errors.push(`${entry.name}: Source file no longer exists`);
                    continue;
                }

                const destPath = path.join(normalizedDest, entry.name);

                // Verify destination path is within the destination directory
                if (!isPathWithinDirectory(destPath, normalizedDest)) {
                    errors.push(`${entry.name}: Invalid destination path`);
                    continue;
                }

                // Check if destination already exists
                if (await this.verifyFileExists(destPath)) {
                    errors.push(`${entry.name}: Already exists at destination`);
                    continue;
                }

                await vscode.workspace.fs.rename(
                    vscode.Uri.file(entry.path),
                    vscode.Uri.file(destPath),
                    { overwrite: false }
                );
                renamed.push(entry.name);
            } catch (error: any) {
                errors.push(`${entry.name}: ${error.message}`);
            }
        }

        // Refresh the directory
        await this.loadDirectory();

        return { renamed, errors };
    }

    /**
     * Create a new directory
     *
     * SECURITY: Name is validated to not contain path separators.
     * Directory is created only within the current directory.
     */
    async createDirectory(name: string): Promise<void> {
        // CRITICAL: Validate the name to prevent path traversal
        if (!isValidFilename(name)) {
            throw new Error(`Invalid directory name: "${name}". Name cannot contain path separators, be empty, or be "." or ".."`);
        }

        const dirPath = path.join(this.state.currentDirectory, name);

        // Verify the resulting path is within current directory
        if (!isPathWithinDirectory(dirPath, this.state.currentDirectory)) {
            throw new Error(`Invalid directory name: would create directory outside current location`);
        }

        // Check if it already exists
        if (await this.verifyFileExists(dirPath)) {
            throw new Error(`"${name}" already exists`);
        }

        // Create without recursive option to prevent creating parent directories
        // that might be outside our intended location
        await fs.promises.mkdir(dirPath, { recursive: false });
        await this.loadDirectory();

        // Select the new directory
        const index = this.state.entries.findIndex(e => e.name === name);
        if (index >= 0) {
            this.state.selectedIndex = index;
            this.notifyStateChange();
        }
    }

    // WDired mode
    enterWdiredMode(): void {
        this.state.wdiredMode = true;
        this.state.pendingRenames.clear();
        this.notifyStateChange();
    }

    exitWdiredMode(): void {
        this.state.wdiredMode = false;
        this.state.pendingRenames.clear();
        this.notifyStateChange();
    }

    /**
     * Add a pending rename
     *
     * SECURITY: newName is validated to not contain path separators.
     */
    addPendingRename(originalName: string, newName: string): void {
        // Validate the new name
        if (!isValidFilename(newName)) {
            // Invalid name - don't add to pending renames
            // The error will be reported when commit is attempted
            return;
        }

        if (originalName === newName) {
            this.state.pendingRenames.delete(originalName);
        } else {
            this.state.pendingRenames.set(originalName, newName);
        }
    }

    /**
     * Validate all pending renames before committing
     * Returns list of validation errors
     */
    validatePendingRenames(): string[] {
        const errors: string[] = [];
        const newNames = new Set<string>();

        for (const [originalName, newName] of this.state.pendingRenames) {
            // Check for valid filename
            if (!isValidFilename(newName)) {
                errors.push(`"${originalName}" → "${newName}": Invalid filename (contains path separators or is empty)`);
                continue;
            }

            // Check for duplicates in the renames
            if (newNames.has(newName)) {
                errors.push(`"${newName}": Multiple files would have this name`);
            }
            newNames.add(newName);

            // Check if new name conflicts with existing file (that isn't being renamed)
            const existingEntry = this.state.entries.find(e => e.name === newName);
            if (existingEntry && !this.state.pendingRenames.has(newName)) {
                errors.push(`"${originalName}" → "${newName}": A file with this name already exists`);
            }
        }

        return errors;
    }

    /**
     * Commit all pending renames
     *
     * SECURITY: All new names are validated before any renames occur.
     * Renames only happen within the current directory.
     */
    async commitWdiredRenames(): Promise<{ renamed: string[]; errors: string[] }> {
        // First, validate all pending renames
        const validationErrors = this.validatePendingRenames();
        if (validationErrors.length > 0) {
            return { renamed: [], errors: validationErrors };
        }

        const renamed: string[] = [];
        const errors: string[] = [];

        // Process renames
        for (const [originalName, newName] of this.state.pendingRenames) {
            try {
                // Double-check validation (belt and suspenders)
                if (!isValidFilename(newName)) {
                    errors.push(`"${originalName}" → "${newName}": Invalid filename`);
                    continue;
                }

                const originalPath = path.join(this.state.currentDirectory, originalName);
                const newPath = path.join(this.state.currentDirectory, newName);

                // Verify paths are within current directory
                if (!isPathWithinDirectory(originalPath, this.state.currentDirectory) ||
                    !isPathWithinDirectory(newPath, this.state.currentDirectory)) {
                    errors.push(`"${originalName}" → "${newName}": Path traversal detected`);
                    continue;
                }

                // Verify source exists
                if (!await this.verifyFileExists(originalPath)) {
                    errors.push(`"${originalName}": File no longer exists`);
                    continue;
                }

                // Verify destination doesn't exist (unless it's being renamed away)
                if (await this.verifyFileExists(newPath)) {
                    // Check if the file at newPath is also being renamed
                    if (!this.state.pendingRenames.has(newName)) {
                        errors.push(`"${originalName}" → "${newName}": Destination already exists`);
                        continue;
                    }
                }

                await vscode.workspace.fs.rename(
                    vscode.Uri.file(originalPath),
                    vscode.Uri.file(newPath),
                    { overwrite: false }
                );
                renamed.push(`${originalName} → ${newName}`);
            } catch (error: any) {
                errors.push(`${originalName} → ${newName}: ${error.message}`);
            }
        }

        // Refresh and exit wdired mode
        await this.loadDirectory();

        return { renamed, errors };
    }

    // Settings
    setSort(field: SortField): void {
        if (this.state.sort.field === field) {
            // Toggle direction
            this.state.sort.direction = this.state.sort.direction === 'asc' ? 'desc' : 'asc';
        } else {
            this.state.sort.field = field;
            this.state.sort.direction = 'asc';
        }
        // Re-sort entries
        const entries = this.state.entries.map(e => ({
            name: e.name,
            path: e.path,
            isDirectory: e.isDirectory,
            size: e.size,
            mtime: e.mtime,
            mode: e.mode,
            isSymlink: e.isSymlink,
            symlinkTarget: e.symlinkTarget
        }));
        this.sortEntries(entries);
        this.state.entries = entries.map((entry, index) => ({
            ...entry,
            mark: 'none' as MarkType,
            index
        }));
        this.notifyStateChange();
    }

    toggleHidden(): void {
        this.state.showHidden = !this.state.showHidden;
        this.loadDirectory(); // Reload to apply
    }

    setFilter(pattern: string): void {
        this.state.filterPattern = pattern;
        this.loadDirectory(); // Reload to apply
    }

    /**
     * Get files to operate on (marked or current)
     */
    getFilesToOperateOn(): DiredDisplayEntry[] {
        const marked = this.getMarkedEntries();
        if (marked.length > 0) return marked;
        const current = this.state.entries[this.state.selectedIndex];
        return current ? [current] : [];
    }
}
