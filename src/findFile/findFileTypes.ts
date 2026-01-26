/**
 * Find File Types
 * Type definitions for the Emacs-style find-file command
 */

import * as vscode from 'vscode';

/**
 * Represents a file or directory entry in find-file
 */
export interface FindFileEntry {
    /** File/directory name */
    name: string;
    /** Full path */
    path: string;
    /** Whether this is a directory */
    isDirectory: boolean;
    /** File size in bytes (0 for directories) */
    size: number;
    /** Last modified timestamp */
    mtime: Date;
}

/**
 * State of the find-file panel
 */
export interface FindFileState {
    /** Current directory path */
    currentDirectory: string;
    /** List of all entries */
    entries: FindFileEntry[];
    /** Filtered entries based on filter text */
    filteredEntries: FindFileEntry[];
    /** Currently selected index (in filteredEntries) */
    selectedIndex: number;
    /** Current filter text */
    filterText: string;
    /** Whether to show hidden files */
    showHidden: boolean;
}

/**
 * Original cursor position when find-file was invoked
 */
export interface OriginalPosition {
    uri: vscode.Uri;
    position: vscode.Position;
}

/**
 * Messages from webview to extension
 */
export type FindFileMessageFromWebview =
    | { command: 'ready' }
    | { command: 'navigate'; direction: 'up' | 'down' | 'pageUp' | 'pageDown' | 'home' | 'end' }
    | { command: 'navigateInto' }       // Tab on directory
    | { command: 'navigateUp' }         // Backspace or ".."
    | { command: 'open' }               // Enter
    | { command: 'action'; action: FindFileAction }  // Speed key action
    | { command: 'filter'; text: string }
    | { command: 'backspace' }          // Delete character from filter
    | { command: 'clearFilter' }        // Clear all filter text
    | { command: 'toggleHidden' }       // Toggle hidden files
    | { command: 'quit' };

/**
 * Messages from extension to webview
 */
export type FindFileMessageToWebview =
    | { command: 'update'; state: SerializedFindFileState }
    | { command: 'error'; message: string }
    | { command: 'info'; message: string };

/**
 * Serialized state for webview
 */
export interface SerializedFindFileState {
    currentDirectory: string;
    entries: FindFileEntry[];
    filteredEntries: FindFileEntry[];
    selectedIndex: number;
    filterText: string;
    showHidden: boolean;
}

/**
 * Convert FindFileState to serializable format
 */
export function serializeState(state: FindFileState): SerializedFindFileState {
    return {
        currentDirectory: state.currentDirectory,
        entries: state.entries,
        filteredEntries: state.filteredEntries,
        selectedIndex: state.selectedIndex,
        filterText: state.filterText,
        showHidden: state.showHidden
    };
}

/**
 * Actions available in the M-o menu
 */
export type FindFileAction =
    | 'insertRelative'
    | 'insertAbsolute'
    | 'orgLinkRelative'
    | 'orgLinkAbsolute'
    | 'openExternal'
    | 'copyRelative'
    | 'copyAbsolute'
    | 'openDired'
    | 'delete'
    | 'rename'
    | 'openSplit';

/**
 * Format file size for display
 */
export function formatSize(bytes: number): string {
    if (bytes === 0) return '-';
    const units = ['B', 'K', 'M', 'G', 'T'];
    let unitIndex = 0;
    let size = bytes;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    if (unitIndex === 0) {
        return `${size}`;
    }
    return `${size.toFixed(1)}${units[unitIndex]}`;
}
