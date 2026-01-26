/**
 * Dired Types
 * Type definitions for the dired file manager
 */

/**
 * Represents a file or directory entry in dired
 */
export interface DiredEntry {
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
    /** Unix permission mode */
    mode: number;
    /** Whether the file is a symlink */
    isSymlink: boolean;
    /** Target path if symlink */
    symlinkTarget?: string;
}

/**
 * Mark state for a file
 */
export type MarkType = 'none' | 'marked' | 'flagged';

/**
 * Entry with its mark state for display
 */
export interface DiredDisplayEntry extends DiredEntry {
    /** Current mark state */
    mark: MarkType;
    /** Index in the list (for navigation) */
    index: number;
}

/**
 * Sort options for directory listing
 */
export type SortField = 'name' | 'size' | 'mtime' | 'extension';
export type SortDirection = 'asc' | 'desc';

export interface SortOptions {
    field: SortField;
    direction: SortDirection;
}

/**
 * State of the dired panel
 */
export interface DiredState {
    /** Current directory path */
    currentDirectory: string;
    /** List of entries */
    entries: DiredDisplayEntry[];
    /** Currently selected index */
    selectedIndex: number;
    /** Whether in wdired mode */
    wdiredMode: boolean;
    /** Pending renames in wdired mode (original name -> new name) */
    pendingRenames: Map<string, string>;
    /** Sort options */
    sort: SortOptions;
    /** Whether to show hidden files */
    showHidden: boolean;
    /** Filter pattern (empty string means no filter) */
    filterPattern: string;
}

/**
 * Messages from webview to extension
 */
export type DiredMessageFromWebview =
    | { command: 'navigate'; direction: 'up' | 'down' | 'pageUp' | 'pageDown' | 'home' | 'end' }
    | { command: 'open'; index: number }
    | { command: 'openParent' }
    | { command: 'mark'; index: number }
    | { command: 'unmark'; index: number }
    | { command: 'toggleMark'; index: number }
    | { command: 'flag'; index: number }
    | { command: 'unmarkAll' }
    | { command: 'toggleAllMarks' }
    | { command: 'markRegex'; pattern: string }
    | { command: 'delete' }
    | { command: 'copy' }
    | { command: 'rename' }
    | { command: 'createDir'; name?: string }
    | { command: 'refresh' }
    | { command: 'promptFilter' }
    | { command: 'promptMarkRegex' }
    | { command: 'toggleHidden' }
    | { command: 'sort'; field: SortField }
    | { command: 'filter'; pattern: string }
    | { command: 'wdiredEnter' }
    | { command: 'wdiredCommit'; renames: { original: string; newName: string }[] }
    | { command: 'wdiredCancel' }
    | { command: 'select'; index: number }
    | { command: 'openInEditor'; index: number }
    | { command: 'openExternal'; index: number }
    | { command: 'copyPath'; index: number }
    | { command: 'showActions' }
    | { command: 'ready' }
    | { command: 'quit' };

/**
 * Messages from extension to webview
 */
export type DiredMessageToWebview =
    | { command: 'update'; state: SerializedDiredState }
    | { command: 'error'; message: string }
    | { command: 'info'; message: string }
    | { command: 'confirmDelete'; files: string[] }
    | { command: 'promptDestination'; operation: 'copy' | 'rename'; files: string[] }
    | { command: 'promptCreateDir' }
    | { command: 'promptFilter' }
    | { command: 'promptMarkRegex' }
    | { command: 'wdiredChanged'; hasChanges: boolean };

/**
 * Serialized state for webview (Maps converted to arrays)
 */
export interface SerializedDiredState {
    currentDirectory: string;
    entries: DiredDisplayEntry[];
    selectedIndex: number;
    wdiredMode: boolean;
    pendingRenames: [string, string][];
    sort: SortOptions;
    showHidden: boolean;
    filterPattern: string;
}

/**
 * Convert DiredState to serializable format
 */
export function serializeState(state: DiredState): SerializedDiredState {
    return {
        currentDirectory: state.currentDirectory,
        entries: state.entries,
        selectedIndex: state.selectedIndex,
        wdiredMode: state.wdiredMode,
        pendingRenames: Array.from(state.pendingRenames.entries()),
        sort: state.sort,
        showHidden: state.showHidden,
        filterPattern: state.filterPattern
    };
}

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

/**
 * Format date for display
 */
export function formatDate(date: Date): string {
    const now = new Date();
    const isThisYear = date.getFullYear() === now.getFullYear();

    const month = date.toLocaleString('en-US', { month: 'short' });
    const day = date.getDate().toString().padStart(2, ' ');

    if (isThisYear) {
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        return `${month} ${day} ${hours}:${minutes}`;
    } else {
        const year = date.getFullYear();
        return `${month} ${day}  ${year}`;
    }
}

/**
 * Format Unix permissions for display (like ls -l)
 */
export function formatPermissions(mode: number, isDirectory: boolean, isSymlink: boolean): string {
    const typeChar = isSymlink ? 'l' : isDirectory ? 'd' : '-';
    const perms = [
        (mode & 0o400) ? 'r' : '-',
        (mode & 0o200) ? 'w' : '-',
        (mode & 0o100) ? 'x' : '-',
        (mode & 0o040) ? 'r' : '-',
        (mode & 0o020) ? 'w' : '-',
        (mode & 0o010) ? 'x' : '-',
        (mode & 0o004) ? 'r' : '-',
        (mode & 0o002) ? 'w' : '-',
        (mode & 0o001) ? 'x' : '-'
    ].join('');
    return typeChar + perms;
}
