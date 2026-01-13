/**
 * Lazy database loader for ScimaxDb
 *
 * This module provides lazy initialization of the database to avoid
 * blocking extension activation. The database is only initialized
 * when first accessed.
 */

import * as vscode from 'vscode';
import { ScimaxDb } from './scimaxDb';
import { createEmbeddingService } from './embeddingService';

let scimaxDb: ScimaxDb | null = null;
let dbInitPromise: Promise<ScimaxDb> | null = null;
let extensionContext: vscode.ExtensionContext | null = null;

/**
 * Set the extension context for database initialization
 * Must be called during extension activation
 */
export function setExtensionContext(context: vscode.ExtensionContext): void {
    extensionContext = context;
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

    const db = new ScimaxDb(context);
    await db.initialize();

    // Set up embedding service if configured
    const embeddingService = createEmbeddingService();
    if (embeddingService) {
        db.setEmbeddingService(embeddingService);
        console.log('ScimaxDb: Semantic search enabled');
    }

    console.log('ScimaxDb: Ready');
    return db;
}

/**
 * Close the database connection
 * Should be called during extension deactivation
 */
export async function closeDatabase(): Promise<void> {
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
