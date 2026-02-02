/**
 * Database Migration System
 *
 * Provides versioned schema migrations with forward migration support.
 * Each migration has a version number and SQL statements to apply.
 */

import type { Client } from '@libsql/client';
import { databaseLogger as log } from '../utils/logger';

/**
 * Migration interface - defines a schema migration
 */
export interface Migration {
    /** Version number (must be unique and sequential) */
    version: number;
    /** Human-readable description */
    description: string;
    /** SQL statements to apply this migration */
    up: string[];
}

/**
 * Migration registry - all migrations in order
 *
 * IMPORTANT: Never modify existing migrations after they've been deployed.
 * Always add new migrations with higher version numbers.
 *
 * Migration versions:
 * - v1: Initial schema (files, headings, source_blocks, links, hashtags, chunks, fts_content)
 * - v2: Add projects table and project_id foreign key
 * - v3: Add db_metadata table for storing configuration like embedding dimensions
 * - v4: Add heading_id to links table for contextual filtering and graph queries
 */
export const migrations: Migration[] = [
    {
        version: 1,
        description: 'Initial schema with FTS5 and vector support',
        up: [
            // Files table
            `CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT UNIQUE NOT NULL,
                file_type TEXT NOT NULL DEFAULT 'org',
                mtime REAL NOT NULL,
                hash TEXT NOT NULL,
                size INTEGER NOT NULL,
                indexed_at INTEGER NOT NULL,
                keywords TEXT DEFAULT '{}'
            )`,

            // Headings table
            `CREATE TABLE IF NOT EXISTS headings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                level INTEGER NOT NULL,
                title TEXT NOT NULL,
                line_number INTEGER NOT NULL,
                begin_pos INTEGER NOT NULL,
                todo_state TEXT,
                priority TEXT,
                tags TEXT DEFAULT '[]',
                inherited_tags TEXT DEFAULT '[]',
                properties TEXT DEFAULT '{}',
                scheduled TEXT,
                deadline TEXT,
                closed TEXT,
                cell_index INTEGER,
                FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
            )`,

            // Source blocks table
            `CREATE TABLE IF NOT EXISTS source_blocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                language TEXT NOT NULL,
                content TEXT NOT NULL,
                line_number INTEGER NOT NULL,
                headers TEXT DEFAULT '{}',
                cell_index INTEGER,
                FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
            )`,

            // Links table
            `CREATE TABLE IF NOT EXISTS links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                link_type TEXT NOT NULL,
                target TEXT NOT NULL,
                description TEXT,
                line_number INTEGER NOT NULL,
                FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
            )`,

            // Hashtags table
            `CREATE TABLE IF NOT EXISTS hashtags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tag TEXT NOT NULL,
                file_path TEXT NOT NULL,
                UNIQUE(tag, file_path)
            )`,

            // Note: chunks table created separately due to dynamic embedding dimensions

            // FTS5 virtual table for full-text search
            `CREATE VIRTUAL TABLE IF NOT EXISTS fts_content USING fts5(
                file_path,
                title,
                content,
                tokenize='porter unicode61'
            )`,

            // Indexes for performance
            `CREATE INDEX IF NOT EXISTS idx_headings_file ON headings(file_id)`,
            `CREATE INDEX IF NOT EXISTS idx_headings_todo ON headings(todo_state)`,
            `CREATE INDEX IF NOT EXISTS idx_headings_deadline ON headings(deadline)`,
            `CREATE INDEX IF NOT EXISTS idx_headings_scheduled ON headings(scheduled)`,
            `CREATE INDEX IF NOT EXISTS idx_blocks_file ON source_blocks(file_id)`,
            `CREATE INDEX IF NOT EXISTS idx_blocks_language ON source_blocks(language)`,
            `CREATE INDEX IF NOT EXISTS idx_links_file ON links(file_id)`,
            `CREATE INDEX IF NOT EXISTS idx_hashtags_tag ON hashtags(tag)`,
            `CREATE INDEX IF NOT EXISTS idx_files_type ON files(file_type)`
        ]
    },
    {
        version: 2,
        description: 'Add projects table and project_id foreign key',
        up: [
            // Projects table
            `CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT 'manual',
                last_opened INTEGER,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
            )`,

            // Add project_id column to files table
            // Note: SQLite doesn't enforce foreign keys on ALTER TABLE, but we add it for documentation
            `ALTER TABLE files ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL`,

            // Indexes for projects
            `CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path)`,
            `CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id)`
        ]
    },
    {
        version: 3,
        description: 'Add db_metadata table for storing configuration like embedding dimensions',
        up: [
            // Metadata table for key-value storage of database configuration
            `CREATE TABLE IF NOT EXISTS db_metadata (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
            )`
        ]
    },
    {
        version: 4,
        description: 'Add heading_id to links table for contextual filtering and graph queries',
        up: [
            // Add heading_id column to links table for associating links with their containing heading
            // This enables filtering links by heading metadata (tags, TODO state, etc.)
            `ALTER TABLE links ADD COLUMN heading_id INTEGER REFERENCES headings(id) ON DELETE SET NULL`,

            // Index for efficient joins when filtering by heading
            `CREATE INDEX IF NOT EXISTS idx_links_heading ON links(heading_id)`,

            // Index for target lookups (backlinks queries)
            `CREATE INDEX IF NOT EXISTS idx_links_target ON links(target)`,

            // Composite index for common query pattern (file + link type)
            `CREATE INDEX IF NOT EXISTS idx_links_file_type ON links(file_path, link_type)`
        ]
    }
];

/**
 * Get the latest migration version
 */
export function getLatestVersion(): number {
    return migrations.length > 0 ? migrations[migrations.length - 1].version : 0;
}

/**
 * Get migrations to apply from current version to latest
 */
export function getPendingMigrations(currentVersion: number): Migration[] {
    return migrations.filter(m => m.version > currentVersion);
}

/**
 * Migration runner - handles schema versioning and migration application
 */
export class MigrationRunner {
    private db: Client;

    constructor(db: Client) {
        this.db = db;
    }

    /**
     * Initialize schema_version table
     */
    async initializeVersionTable(): Promise<void> {
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL,
                description TEXT
            )
        `);
    }

    /**
     * Get current schema version
     */
    async getCurrentVersion(): Promise<number> {
        try {
            const result = await this.db.execute(
                'SELECT MAX(version) as version FROM schema_version'
            );
            const row = result.rows[0];
            return (row?.version as number) || 0;
        } catch {
            // Table doesn't exist yet
            return 0;
        }
    }

    /**
     * Record a migration as applied
     */
    async recordMigration(migration: Migration): Promise<void> {
        await this.db.execute({
            sql: 'INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)',
            args: [migration.version, Date.now(), migration.description]
        });
    }

    /**
     * Check if this is a fresh database (no tables exist)
     */
    async isFreshDatabase(): Promise<boolean> {
        try {
            const result = await this.db.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            );
            return result.rows.length === 0;
        } catch {
            return true;
        }
    }

    /**
     * Detect schema version for legacy databases without version table
     * Returns the version that matches the current schema
     */
    async detectLegacyVersion(): Promise<number> {
        // Check for projects table (added in v2)
        try {
            await this.db.execute('SELECT 1 FROM projects LIMIT 1');
            return 2; // Has projects table
        } catch {
            // No projects table
        }

        // Check for files table (added in v1)
        try {
            await this.db.execute('SELECT 1 FROM files LIMIT 1');
            return 1; // Has basic schema
        } catch {
            // No tables at all
            return 0;
        }
    }

    /**
     * Run all pending migrations
     * Returns the number of migrations applied
     */
    async runMigrations(): Promise<{ applied: number; currentVersion: number }> {
        // Initialize version tracking table
        await this.initializeVersionTable();

        // Get current version
        let currentVersion = await this.getCurrentVersion();

        // If no version recorded but tables exist, detect legacy version
        if (currentVersion === 0 && !(await this.isFreshDatabase())) {
            currentVersion = await this.detectLegacyVersion();
            if (currentVersion > 0) {
                log.info('Detected legacy schema version', { version: currentVersion });
                // Record all versions up to detected version
                for (const migration of migrations.filter(m => m.version <= currentVersion)) {
                    await this.recordMigration(migration);
                }
            }
        }

        // Get pending migrations
        const pending = getPendingMigrations(currentVersion);

        if (pending.length === 0) {
            log.info('Schema is up to date', { version: currentVersion });
            return { applied: 0, currentVersion };
        }

        log.info('Applying migrations', { count: pending.length, from: currentVersion, to: getLatestVersion() });

        // Apply each migration in order
        for (const migration of pending) {
            log.info('Applying migration', { version: migration.version, description: migration.description });

            try {
                // Execute all SQL statements in the migration
                for (const sql of migration.up) {
                    try {
                        await this.db.execute(sql);
                    } catch (e: any) {
                        // Some statements may fail if objects already exist (idempotent migrations)
                        // This is expected for ALTER TABLE when column exists
                        if (e.message?.includes('duplicate column name') ||
                            e.message?.includes('already exists')) {
                            log.debug('Skipping migration (already exists)', { sql: sql.slice(0, 50) });
                            continue;
                        }
                        throw e;
                    }
                }

                // Record successful migration
                await this.recordMigration(migration);
                currentVersion = migration.version;

                log.info('Migration complete', { version: migration.version });
            } catch (e) {
                log.error('Migration failed', e as Error, { version: migration.version });
                throw new Error(`Migration v${migration.version} failed: ${e}`);
            }
        }

        return { applied: pending.length, currentVersion };
    }

    /**
     * Get migration history
     */
    async getMigrationHistory(): Promise<Array<{ version: number; applied_at: number; description: string }>> {
        try {
            const result = await this.db.execute(
                'SELECT version, applied_at, description FROM schema_version ORDER BY version'
            );
            return result.rows.map(row => ({
                version: row.version as number,
                applied_at: row.applied_at as number,
                description: row.description as string
            }));
        } catch {
            return [];
        }
    }
}
