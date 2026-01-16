/**
 * Database command - rebuild, stats, maintenance
 */

import * as fs from 'fs';
import * as path from 'path';
import { createCliDatabase, CliDbStats } from '../database';

interface CliConfig {
    dbPath: string;
    rootDir: string;
}

interface ParsedArgs {
    command: string;
    subcommand?: string;
    args: string[];
    flags: Record<string, string | boolean>;
}

export async function dbCommand(config: CliConfig, args: ParsedArgs): Promise<void> {
    const subcommand = args.subcommand || 'stats';

    switch (subcommand) {
        case 'rebuild':
            await rebuildDatabase(config, args);
            break;
        case 'stats':
            await showStats(config);
            break;
        case 'check':
            await checkDatabase(config);
            break;
        default:
            console.log(`
scimax db - Database operations

USAGE:
    scimax db stats         Show database statistics
    scimax db rebuild       Rebuild database from org files
    scimax db check         Check for stale/missing entries

OPTIONS:
    --path <dir>    Directory to scan (default: current)
    --force         Force full rebuild
`);
    }
}

async function showStats(config: CliConfig): Promise<void> {
    const db = await createCliDatabase(config.dbPath);

    try {
        const stats = await db.getStats();

        console.log('=== Database Statistics ===\n');
        console.log(`  Database: ${config.dbPath}`);
        console.log(`  Root: ${config.rootDir}`);
        console.log();
        console.log(`  Files indexed: ${stats.fileCount}`);
        console.log(`  Headings: ${stats.headingCount}`);
        console.log(`  TODO items: ${stats.todoCount}`);
        console.log(`  Has embeddings: ${stats.hasEmbeddings ? 'Yes' : 'No'}`);
    } finally {
        await db.close();
    }
}

async function rebuildDatabase(config: CliConfig, args: ParsedArgs): Promise<void> {
    const scanDir = typeof args.flags.path === 'string'
        ? path.resolve(args.flags.path)
        : config.rootDir;

    console.log(`Rebuilding database from: ${scanDir}`);
    console.log(`Database path: ${config.dbPath}`);
    console.log();

    // Note: Full rebuild requires VS Code context for proper indexing
    // This is a placeholder showing what the CLI would do
    console.log('NOTE: Database rebuild from CLI is not yet fully implemented.');
    console.log('For now, open the folder in VS Code and the extension will index automatically.');
    console.log();

    // Find all org files to show what would be indexed
    const orgFiles = findOrgFiles(scanDir);
    console.log(`Found ${orgFiles.length} org file(s) that would be indexed:`);

    for (const file of orgFiles.slice(0, 10)) {
        console.log(`  ${path.relative(scanDir, file)}`);
    }
    if (orgFiles.length > 10) {
        console.log(`  ... and ${orgFiles.length - 10} more`);
    }
}

function findOrgFiles(dir: string, files: string[] = []): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip common ignore patterns
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.scimax') {
            continue;
        }

        if (entry.isDirectory()) {
            findOrgFiles(fullPath, files);
        } else if (entry.isFile() && entry.name.endsWith('.org')) {
            files.push(fullPath);
        }
    }

    return files;
}

async function checkDatabase(config: CliConfig): Promise<void> {
    if (!fs.existsSync(config.dbPath)) {
        console.log('Database not found:', config.dbPath);
        console.log('Open the folder in VS Code to create the database.');
        return;
    }

    const db = await createCliDatabase(config.dbPath);

    try {
        console.log('Checking database integrity...\n');

        const files = await db.getIndexedFiles();
        let missing = 0;

        for (const file of files) {
            const fullPath = path.join(config.rootDir, file.path);

            if (!fs.existsSync(fullPath)) {
                console.log(`MISSING: ${file.path}`);
                missing++;
            }
        }

        console.log();
        console.log(`Total files in database: ${files.length}`);
        console.log(`Missing files: ${missing}`);

        if (missing > 0) {
            console.log('\nOpen VS Code to rebuild the index.');
        } else {
            console.log('\nDatabase looks good.');
        }
    } finally {
        await db.close();
    }
}
