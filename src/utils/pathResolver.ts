/**
 * Shared path resolution utilities for Scimax
 *
 * Provides consistent path expansion and resolution for all Scimax directories
 * (journal, templates, capture) using a central scimax.directory setting.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

/**
 * Expand tilde (~) in a file path to the user's home directory
 */
export function expandTilde(filePath: string): string {
    if (!filePath) {
        return filePath;
    }
    if (filePath.startsWith('~')) {
        return path.join(os.homedir(), filePath.slice(1));
    }
    return filePath;
}

/**
 * Get the root scimax directory from configuration
 * Falls back to ~/scimax if not configured
 */
export function getScimaxDirectory(): string {
    const config = vscode.workspace.getConfiguration('scimax');
    const directory = config.get<string>('directory') || '';

    if (directory) {
        return expandTilde(directory);
    }

    return path.join(os.homedir(), 'scimax');
}

/**
 * Resolve a scimax subdirectory path
 *
 * Priority:
 * 1. If the specific setting (e.g., scimax.journal.directory) is set, use that
 * 2. Otherwise, use {scimax.directory}/{defaultSubdir}
 *
 * @param settingPath - The configuration setting path (e.g., 'scimax.journal.directory')
 * @param defaultSubdir - The default subdirectory name (e.g., 'journal', 'templates')
 * @returns The resolved directory path
 */
export function resolveScimaxPath(settingPath: string, defaultSubdir: string): string {
    // Split the setting path to get the configuration namespace
    const parts = settingPath.split('.');
    if (parts.length < 2) {
        return path.join(getScimaxDirectory(), defaultSubdir);
    }

    // Get the specific setting value
    const namespace = parts.slice(0, -1).join('.');
    const property = parts[parts.length - 1];
    const config = vscode.workspace.getConfiguration(namespace);
    const specificPath = config.get<string>(property) || '';

    if (specificPath) {
        // User has explicitly set this directory
        return expandTilde(specificPath);
    }

    // Fall back to scimax.directory/defaultSubdir
    return path.join(getScimaxDirectory(), defaultSubdir);
}

/**
 * Resolve a file path relative to a base directory
 * Handles absolute paths, tilde expansion, and relative paths
 *
 * @param filePath - The file path to resolve
 * @param defaultDir - The default directory for relative paths
 * @returns The resolved absolute file path
 */
export function resolveFilePath(filePath: string, defaultDir: string): string {
    if (!filePath) {
        return '';
    }

    // Handle absolute paths
    if (path.isAbsolute(filePath)) {
        return filePath;
    }

    // Handle tilde expansion
    if (filePath.startsWith('~')) {
        return expandTilde(filePath);
    }

    // Handle relative paths - resolve against default directory
    if (defaultDir) {
        const resolvedDefault = expandTilde(defaultDir);
        return path.join(resolvedDefault, filePath);
    }

    // Fall back to workspace folder
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceFolder) {
        return path.join(workspaceFolder, filePath);
    }

    return filePath;
}

/**
 * Get the default capture file path
 * Uses scimax.capture.defaultFile if set, otherwise {scimax.directory}/notes.org
 */
export function getDefaultCaptureFile(): string {
    const config = vscode.workspace.getConfiguration('scimax.capture');
    const defaultFile = config.get<string>('defaultFile') || '';

    if (defaultFile) {
        return expandTilde(defaultFile);
    }

    return path.join(getScimaxDirectory(), 'notes.org');
}
