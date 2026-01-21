/**
 * Lazy database loader for ScimaxDb
 *
 * This module provides lazy initialization of the database to avoid
 * blocking extension activation. The database is only initialized
 * when first accessed.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { ScimaxDb } from './scimaxDb';
import { createEmbeddingServiceAsync } from './embeddingService';
import { initSecretStorage, migrateApiKeyFromSettings } from './secretStorage';
import { resolveScimaxPath } from '../utils/pathResolver';

let scimaxDb: ScimaxDb | null = null;
let dbInitPromise: Promise<ScimaxDb> | null = null;
let extensionContext: vscode.ExtensionContext | null = null;
let staleCheckCancellation: { cancelled: boolean } | null = null;
let staleCheckStatusBar: vscode.StatusBarItem | null = null;

/**
 * Set the extension context for database initialization
 * Must be called during extension activation
 */
export function setExtensionContext(context: vscode.ExtensionContext): void {
    extensionContext = context;
    // Initialize SecretStorage for secure credential management
    initSecretStorage(context);
}

/**
 * Get the extension context (for accessing globalState, etc.)
 */
export function getExtensionContext(): vscode.ExtensionContext | null {
    return extensionContext;
}

/**
 * Get the database instance, initializing it lazily if needed.
 * Returns null if context hasn't been set or initialization fails.
 */
export async function getDatabase(): Promise<ScimaxDb | null> {
    // Already initialized
    if (scimaxDb) {
        return scimaxDb;
    }

    // Initialization in progress
    if (dbInitPromise) {
        return dbInitPromise;
    }

    // No context set
    if (!extensionContext) {
        console.warn('ScimaxDb: Cannot initialize - extension context not set');
        return null;
    }

    // Start initialization
    dbInitPromise = initializeDatabase(extensionContext);

    try {
        scimaxDb = await dbInitPromise;
        return scimaxDb;
    } catch (error) {
        console.error('ScimaxDb: Initialization failed:', error);
        dbInitPromise = null;
        return null;
    }
}

/**
 * Check if database is available without triggering initialization
 */
export function isDatabaseInitialized(): boolean {
    return scimaxDb !== null;
}

/**
 * Initialize the database (internal function)
 */
async function initializeDatabase(context: vscode.ExtensionContext): Promise<ScimaxDb> {
    console.log('ScimaxDb: Initializing lazily...');

    // Migrate API keys from settings to SecretStorage (one-time migration)
    await migrateApiKeyFromSettings();

    const db = new ScimaxDb(context);
    await db.initialize();

    // Set up embedding service if configured (using async version for SecretStorage support)
    const embeddingService = await createEmbeddingServiceAsync();
    if (embeddingService) {
        db.setEmbeddingService(embeddingService);
        console.log('ScimaxDb: Semantic search enabled');
    }

    console.log('ScimaxDb: Ready');

    // Schedule background stale file check after a delay
    scheduleStaleFileCheck(db);

    return db;
}

/**
 * Schedule a background check for stale files and directory scanning.
 * Runs after a delay to not interfere with startup.
 *
 * Phase 1: Check already-indexed files for staleness (modified/deleted externally)
 * Phase 2: Scan configured directories for new files
 */
function scheduleStaleFileCheck(db: ScimaxDb): void {
    const config = vscode.workspace.getConfiguration('scimax.db');
    const autoCheckStale = config.get<boolean>('autoCheckStale', true);

    if (!autoCheckStale) {
        console.log('ScimaxDb: Auto stale check disabled');
        return;
    }

    const delayMs = config.get<number>('staleCheckDelayMs', 5000);

    setTimeout(async () => {
        // Don't run if database was closed
        if (!scimaxDb) return;

        // Create cancellation token
        staleCheckCancellation = { cancelled: false };

        // Create subtle status bar item with click-to-cancel
        staleCheckStatusBar = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            0
        );
        staleCheckStatusBar.text = '$(sync~spin) Checking files...';
        staleCheckStatusBar.tooltip = 'Scimax: Checking for externally modified files (click to cancel)';
        staleCheckStatusBar.command = 'scimax.db.cancelSync';
        staleCheckStatusBar.show();

        let totalReindexed = 0;
        let totalNew = 0;
        let totalDeleted = 0;

        try {
            // Get limits from config (with sensible defaults to avoid OOM)
            const maxReindex = config.get<number>('maxReindexPerSync', 50);
            const maxNewFiles = config.get<number>('maxNewFilesPerSync', 50);

            // Phase 1: Check stale files (already indexed)
            const staleResult = await db.checkStaleFiles({
                batchSize: 50,
                yieldMs: 50,
                maxReindex,
                cancellationToken: staleCheckCancellation,
                onProgress: ({ checked, total, reindexed }) => {
                    if (staleCheckStatusBar) {
                        staleCheckStatusBar.text = `$(sync~spin) Checking files (${checked}/${total})`;
                        if (reindexed > 0) {
                            staleCheckStatusBar.tooltip = `Scimax: Reindexed ${reindexed} modified files`;
                        }
                    }
                }
            });

            totalReindexed += staleResult.reindexed;
            totalDeleted = staleResult.deleted;

            // Phase 2: Scan configured directories for new files
            if (!staleCheckCancellation?.cancelled) {
                const directories: string[] = [];

                // Include journal directory if enabled
                if (config.get<boolean>('includeJournal', true)) {
                    const journalDir = resolveScimaxPath('scimax.journal.directory', 'journal');
                    if (journalDir && fs.existsSync(journalDir)) {
                        directories.push(journalDir);
                    }
                }

                // Include workspace folders if enabled
                if (config.get<boolean>('includeWorkspace', true)) {
                    const workspaceFolders = vscode.workspace.workspaceFolders || [];
                    for (const folder of workspaceFolders) {
                        directories.push(folder.uri.fsPath);
                    }
                }

                // Include scimax projects if enabled
                if (config.get<boolean>('includeProjects', true) && extensionContext) {
                    interface Project { path: string; }
                    const projects = extensionContext.globalState.get<Project[]>('scimax.projects', []);
                    for (const project of projects) {
                        if (fs.existsSync(project.path)) {
                            directories.push(project.path);
                        }
                    }
                }

                // Include additional directories from config
                const additionalDirs = config.get<string[]>('include') || [];
                for (let dir of additionalDirs) {
                    // Expand ~ for home directory
                    if (dir.startsWith('~')) {
                        dir = dir.replace(/^~/, process.env.HOME || '');
                    }
                    if (fs.existsSync(dir)) {
                        directories.push(dir);
                    }
                }

                // Deduplicate
                const uniqueDirs = [...new Set(directories)];

                if (uniqueDirs.length > 0) {
                    if (staleCheckStatusBar) {
                        staleCheckStatusBar.text = '$(sync~spin) Scanning directories...';
                        staleCheckStatusBar.tooltip = 'Scimax: Scanning for new files in configured directories';
                    }

                    const scanResult = await db.scanDirectoriesInBackground(uniqueDirs, {
                        batchSize: 50,
                        yieldMs: 50,
                        maxIndex: maxNewFiles,
                        cancellationToken: staleCheckCancellation,
                        onProgress: ({ scanned, total, indexed, currentDir }) => {
                            if (staleCheckStatusBar) {
                                if (currentDir) {
                                    staleCheckStatusBar.text = `$(sync~spin) Scanning: ${currentDir.split('/').pop()}`;
                                } else {
                                    staleCheckStatusBar.text = `$(sync~spin) Scanning files (${scanned}/${total})`;
                                }
                                if (indexed > 0) {
                                    staleCheckStatusBar.tooltip = `Scimax: Found ${indexed} new/changed files`;
                                }
                            }
                        }
                    });

                    totalReindexed += scanResult.changed;
                    totalNew = scanResult.newFiles;
                }
            }

            // Show result briefly if anything changed
            const totalChanges = totalReindexed + totalNew + totalDeleted;
            if (totalChanges > 0) {
                if (staleCheckStatusBar) {
                    const parts: string[] = [];
                    if (totalNew > 0) parts.push(`${totalNew} new`);
                    if (totalReindexed > 0) parts.push(`${totalReindexed} updated`);
                    if (totalDeleted > 0) parts.push(`${totalDeleted} removed`);
                    staleCheckStatusBar.text = `$(check) ${parts.join(', ')}`;
                    staleCheckStatusBar.tooltip = 'Scimax: Background sync complete';
                    setTimeout(() => {
                        staleCheckStatusBar?.dispose();
                        staleCheckStatusBar = null;
                    }, 3000);
                }
            } else {
                staleCheckStatusBar?.dispose();
                staleCheckStatusBar = null;
            }
        } catch (error) {
            console.error('ScimaxDb: Background sync failed:', error);
            staleCheckStatusBar?.dispose();
            staleCheckStatusBar = null;
        }

        staleCheckCancellation = null;
    }, delayMs);
}

/**
 * Cancel any running stale file check
 */
export function cancelStaleFileCheck(): void {
    if (staleCheckCancellation) {
        staleCheckCancellation.cancelled = true;
    }
    if (staleCheckStatusBar) {
        staleCheckStatusBar.dispose();
        staleCheckStatusBar = null;
    }
}

/**
 * Close the database connection
 * Should be called during extension deactivation
 */
export async function closeDatabase(): Promise<void> {
    // Cancel any running stale check
    cancelStaleFileCheck();

    if (scimaxDb) {
        await scimaxDb.close();
        scimaxDb = null;
        dbInitPromise = null;
        console.log('ScimaxDb: Closed');
    }
}

/**
 * Reset the database state (for testing)
 */
export function resetDatabaseState(): void {
    scimaxDb = null;
    dbInitPromise = null;
    extensionContext = null;
}
