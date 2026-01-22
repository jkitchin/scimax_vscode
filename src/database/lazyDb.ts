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
import { databaseLogger as log } from '../utils/logger';

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
        log.warn('Cannot initialize - extension context not set');
        return null;
    }

    // Start initialization
    dbInitPromise = initializeDatabase(extensionContext);

    try {
        scimaxDb = await dbInitPromise;
        return scimaxDb;
    } catch (error) {
        log.error('Initialization failed', error as Error);
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
    log.info('Initializing lazily...');

    // Migrate API keys from settings to SecretStorage (one-time migration)
    await migrateApiKeyFromSettings();

    const db = new ScimaxDb(context);
    await db.initialize();

    // Set up embedding service if configured (using async version for SecretStorage support)
    const embeddingService = await createEmbeddingServiceAsync();
    if (embeddingService) {
        db.setEmbeddingService(embeddingService);
        log.info('Semantic search enabled');
    }

    log.info('Ready');

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
    // Default to false to prevent OOM on startup with large project counts
    // Users can enable with scimax.db.autoCheckStale: true
    const autoCheckStale = config.get<boolean>('autoCheckStale', false);

    if (!autoCheckStale) {
        log.debug('Auto stale check disabled (set scimax.db.autoCheckStale to true to enable)');
        return;
    }

    const delayMs = config.get<number>('staleCheckDelayMs', 5000);

    setTimeout(async () => {
        // Don't run if database was closed
        if (!scimaxDb) return;

        // Create cancellation token
        staleCheckCancellation = { cancelled: false };

        // Create status bar item with click-to-cancel (make it obvious)
        staleCheckStatusBar = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            0
        );
        staleCheckStatusBar.text = '$(sync~spin) Indexing $(close)';
        staleCheckStatusBar.tooltip = 'Scimax: Background file indexing in progress\nClick to STOP';
        staleCheckStatusBar.command = 'scimax.db.cancelSync';
        staleCheckStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        staleCheckStatusBar.show();

        let totalReindexed = 0;
        let totalNew = 0;
        let totalDeleted = 0;

        try {
            // Get limits from config
            // Default to 100 files per sync to avoid blocking the UI during background operations
            // Users can set to 0 for unlimited if they want full sync on startup
            const maxReindex = config.get<number>('maxReindexPerSync', 100);
            const maxNewFiles = config.get<number>('maxNewFilesPerSync', 100);

            // Phase 1: Check stale files (already indexed)
            // Use smaller batches and longer yields to keep UI responsive
            const staleResult = await db.checkStaleFiles({
                batchSize: 25,
                yieldMs: 10,
                maxReindex,
                cancellationToken: staleCheckCancellation,
                onProgress: ({ checked, total, reindexed }) => {
                    if (staleCheckStatusBar) {
                        staleCheckStatusBar.text = `$(sync~spin) Checking (${checked}/${total}) $(close)`;
                        staleCheckStatusBar.tooltip = `Scimax: Checking files for changes\n${reindexed > 0 ? `Reindexed: ${reindexed}\n` : ''}Click to STOP`;
                    }
                }
            });

            totalReindexed += staleResult.reindexed;
            totalDeleted = staleResult.deleted;

            // Phase 2: Scan configured directories for new files
            if (!staleCheckCancellation?.cancelled) {
                const directories: string[] = [];
                // Limit directories to prevent OOM on systems with many projects
                // Default to 20 directories max for background scanning
                const maxDirectories = config.get<number>('maxDirectoriesPerSync', 20);

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
                // Default to FALSE for background scan - scanning 500+ projects causes OOM
                if (config.get<boolean>('includeProjects', false) && extensionContext) {
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

                // Deduplicate and limit to prevent OOM
                let uniqueDirs = [...new Set(directories)];
                if (maxDirectories > 0 && uniqueDirs.length > maxDirectories) {
                    log.warn('Limiting directories for background scan', {
                        total: uniqueDirs.length,
                        limit: maxDirectories
                    });
                    uniqueDirs = uniqueDirs.slice(0, maxDirectories);
                }

                if (uniqueDirs.length > 0) {
                    if (staleCheckStatusBar) {
                        staleCheckStatusBar.text = '$(sync~spin) Scanning $(close)';
                        staleCheckStatusBar.tooltip = 'Scimax: Scanning for new files\nClick to STOP';
                    }

                    const scanResult = await db.scanDirectoriesInBackground(uniqueDirs, {
                        batchSize: 25,
                        yieldMs: 10,
                        maxIndex: maxNewFiles,
                        cancellationToken: staleCheckCancellation,
                        onProgress: ({ scanned, total, indexed, currentDir }) => {
                            if (staleCheckStatusBar) {
                                // Show progress with stop button
                                staleCheckStatusBar.text = `$(sync~spin) Scanning (${indexed}) $(close)`;
                                // Show detailed progress in tooltip on hover
                                const dirName = currentDir ? currentDir.split('/').pop() : '';
                                staleCheckStatusBar.tooltip = `Scimax: Scanning ${dirName}\nIndexed: ${indexed} files\nClick to STOP`;
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
            log.error('Background sync failed', error as Error);
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
        log.info('Closed');
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
