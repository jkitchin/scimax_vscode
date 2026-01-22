/**
 * Tests for database migration system
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the logger module before importing migrations
vi.mock('../../utils/logger', () => ({
    databaseLogger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

import {
    migrations,
    getLatestVersion,
    getPendingMigrations,
    MigrationRunner,
    type Migration
} from '../migrations';

// Mock @libsql/client
const mockExecute = vi.fn();
const mockDb = {
    execute: mockExecute
};

describe('migrations', () => {
    describe('migrations registry', () => {
        it('should have migrations defined', () => {
            expect(migrations.length).toBeGreaterThan(0);
        });

        it('should have sequential version numbers', () => {
            for (let i = 0; i < migrations.length; i++) {
                expect(migrations[i].version).toBe(i + 1);
            }
        });

        it('should have descriptions for all migrations', () => {
            for (const migration of migrations) {
                expect(migration.description).toBeTruthy();
                expect(typeof migration.description).toBe('string');
            }
        });

        it('should have SQL statements for all migrations', () => {
            for (const migration of migrations) {
                expect(migration.up.length).toBeGreaterThan(0);
                for (const sql of migration.up) {
                    expect(typeof sql).toBe('string');
                    expect(sql.trim().length).toBeGreaterThan(0);
                }
            }
        });
    });

    describe('getLatestVersion', () => {
        it('should return the highest version number', () => {
            const latest = getLatestVersion();
            expect(latest).toBe(migrations[migrations.length - 1].version);
        });
    });

    describe('getPendingMigrations', () => {
        it('should return all migrations when starting from 0', () => {
            const pending = getPendingMigrations(0);
            expect(pending).toEqual(migrations);
        });

        it('should return no migrations when up to date', () => {
            const pending = getPendingMigrations(getLatestVersion());
            expect(pending).toEqual([]);
        });

        it('should return only newer migrations', () => {
            const pending = getPendingMigrations(1);
            expect(pending.length).toBe(migrations.length - 1);
            expect(pending.every(m => m.version > 1)).toBe(true);
        });
    });
});

describe('MigrationRunner', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('initializeVersionTable', () => {
        it('should create schema_version table', async () => {
            mockExecute.mockResolvedValue({ rows: [] });
            const runner = new MigrationRunner(mockDb as any);

            await runner.initializeVersionTable();

            expect(mockExecute).toHaveBeenCalledWith(
                expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_version')
            );
        });
    });

    describe('getCurrentVersion', () => {
        it('should return 0 for new database', async () => {
            mockExecute.mockRejectedValue(new Error('no such table'));
            const runner = new MigrationRunner(mockDb as any);

            const version = await runner.getCurrentVersion();

            expect(version).toBe(0);
        });

        it('should return max version from table', async () => {
            mockExecute.mockResolvedValue({ rows: [{ version: 2 }] });
            const runner = new MigrationRunner(mockDb as any);

            const version = await runner.getCurrentVersion();

            expect(version).toBe(2);
        });

        it('should return 0 for null version', async () => {
            mockExecute.mockResolvedValue({ rows: [{ version: null }] });
            const runner = new MigrationRunner(mockDb as any);

            const version = await runner.getCurrentVersion();

            expect(version).toBe(0);
        });
    });

    describe('isFreshDatabase', () => {
        it('should return true for empty database', async () => {
            mockExecute.mockResolvedValue({ rows: [] });
            const runner = new MigrationRunner(mockDb as any);

            const fresh = await runner.isFreshDatabase();

            expect(fresh).toBe(true);
        });

        it('should return false for database with tables', async () => {
            mockExecute.mockResolvedValue({ rows: [{ name: 'files' }] });
            const runner = new MigrationRunner(mockDb as any);

            const fresh = await runner.isFreshDatabase();

            expect(fresh).toBe(false);
        });
    });

    describe('detectLegacyVersion', () => {
        it('should detect v2 with projects table', async () => {
            mockExecute.mockResolvedValue({ rows: [{ 1: 1 }] });
            const runner = new MigrationRunner(mockDb as any);

            const version = await runner.detectLegacyVersion();

            expect(version).toBe(2);
        });

        it('should detect v1 without projects table', async () => {
            mockExecute
                .mockRejectedValueOnce(new Error('no such table: projects'))
                .mockResolvedValueOnce({ rows: [{ 1: 1 }] });
            const runner = new MigrationRunner(mockDb as any);

            const version = await runner.detectLegacyVersion();

            expect(version).toBe(1);
        });

        it('should detect v0 for empty database', async () => {
            mockExecute
                .mockRejectedValueOnce(new Error('no such table: projects'))
                .mockRejectedValueOnce(new Error('no such table: files'));
            const runner = new MigrationRunner(mockDb as any);

            const version = await runner.detectLegacyVersion();

            expect(version).toBe(0);
        });
    });

    describe('recordMigration', () => {
        it('should insert migration record', async () => {
            mockExecute.mockResolvedValue({ rows: [] });
            const runner = new MigrationRunner(mockDb as any);

            const migration: Migration = {
                version: 1,
                description: 'Test migration',
                up: ['SELECT 1']
            };

            await runner.recordMigration(migration);

            expect(mockExecute).toHaveBeenCalledWith({
                sql: expect.stringContaining('INSERT INTO schema_version'),
                args: [1, expect.any(Number), 'Test migration']
            });
        });
    });

    describe('getMigrationHistory', () => {
        it('should return migration history', async () => {
            mockExecute.mockResolvedValue({
                rows: [
                    { version: 1, applied_at: 1000, description: 'Initial' },
                    { version: 2, applied_at: 2000, description: 'Projects' }
                ]
            });
            const runner = new MigrationRunner(mockDb as any);

            const history = await runner.getMigrationHistory();

            expect(history).toEqual([
                { version: 1, applied_at: 1000, description: 'Initial' },
                { version: 2, applied_at: 2000, description: 'Projects' }
            ]);
        });

        it('should return empty array on error', async () => {
            mockExecute.mockRejectedValue(new Error('no such table'));
            const runner = new MigrationRunner(mockDb as any);

            const history = await runner.getMigrationHistory();

            expect(history).toEqual([]);
        });
    });
});

describe('Migration v1', () => {
    const v1 = migrations.find(m => m.version === 1)!;

    it('should create files table', () => {
        expect(v1.up.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS files'))).toBe(true);
    });

    it('should create headings table', () => {
        expect(v1.up.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS headings'))).toBe(true);
    });

    it('should create source_blocks table', () => {
        expect(v1.up.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS source_blocks'))).toBe(true);
    });

    it('should create links table', () => {
        expect(v1.up.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS links'))).toBe(true);
    });

    it('should create hashtags table', () => {
        expect(v1.up.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS hashtags'))).toBe(true);
    });

    it('should create FTS5 table', () => {
        expect(v1.up.some(sql => sql.includes('CREATE VIRTUAL TABLE IF NOT EXISTS fts_content USING fts5'))).toBe(true);
    });

    it('should create performance indexes', () => {
        expect(v1.up.some(sql => sql.includes('CREATE INDEX IF NOT EXISTS idx_headings_todo'))).toBe(true);
        expect(v1.up.some(sql => sql.includes('CREATE INDEX IF NOT EXISTS idx_headings_deadline'))).toBe(true);
    });
});

describe('Migration v2', () => {
    const v2 = migrations.find(m => m.version === 2)!;

    it('should create projects table', () => {
        expect(v2.up.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS projects'))).toBe(true);
    });

    it('should add project_id column to files', () => {
        expect(v2.up.some(sql => sql.includes('ALTER TABLE files ADD COLUMN project_id'))).toBe(true);
    });

    it('should create projects index', () => {
        expect(v2.up.some(sql => sql.includes('CREATE INDEX IF NOT EXISTS idx_projects_path'))).toBe(true);
    });
});
