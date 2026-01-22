/**
 * Database command - rebuild, stats, maintenance
 */

import * as fs from 'fs';
import * as path from 'path';
import { createCliDatabase, CliDocument } from '../database';
import { parseToLegacyFormat, flattenHeadings } from '../../parser/orgParserAdapter';

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
        case 'scan':
            await scanDirectory(config, args);
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
    scimax db stats             Show database statistics
    scimax db rebuild           Rebuild database from org files
    scimax db scan <dir>        Scan a specific directory and add to database
    scimax db check             Check for stale/missing entries

OPTIONS:
    --path <dir>    Directory to scan (default: current) [for rebuild]
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

    // Find all org files
    const orgFiles = findOrgFiles(scanDir);
    console.log(`Found ${orgFiles.length} org file(s) to index.`);
    console.log();

    if (orgFiles.length === 0) {
        console.log('No org files found.');
        return;
    }

    const db = await createCliDatabase(config.dbPath);

    try {
        let indexed = 0;
        let errors = 0;

        for (const filePath of orgFiles) {
            const relativePath = path.relative(scanDir, filePath);
            process.stdout.write(`  Indexing: ${relativePath}...`);

            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const legacyDoc = parseToLegacyFormat(content);

                // Convert LegacyDocument to CliDocument format
                const cliDoc: CliDocument = {
                    headings: flattenHeadings(legacyDoc.headings).map(h => ({
                        level: h.level,
                        title: h.title,
                        lineNumber: h.lineNumber,
                        todoState: h.todoState,
                        priority: h.priority,
                        tags: h.tags,
                        properties: h.properties,
                    })),
                    sourceBlocks: legacyDoc.sourceBlocks.map(b => ({
                        language: b.language,
                        content: b.content,
                        lineNumber: b.lineNumber,
                        headers: b.headers,
                    })),
                    links: legacyDoc.links.map(l => ({
                        type: l.type,
                        target: l.target,
                        description: l.description,
                        lineNumber: l.lineNumber,
                    })),
                };

                await db.indexFile(filePath, cliDoc);
                indexed++;
                console.log(' OK');
            } catch (err) {
                errors++;
                console.log(` ERROR: ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        console.log();
        console.log(`Indexed: ${indexed} file(s)`);
        if (errors > 0) {
            console.log(`Errors: ${errors} file(s)`);
        }
    } finally {
        await db.close();
    }
}

async function scanDirectory(config: CliConfig, args: ParsedArgs): Promise<void> {
    const dirArg = args.args[0];

    if (!dirArg) {
        console.error('Error: scan requires a directory argument');
        console.log('Usage: scimax db scan <directory>');
        process.exit(1);
    }

    const scanDir = path.resolve(dirArg);

    if (!fs.existsSync(scanDir)) {
        console.error(`Error: directory does not exist: ${scanDir}`);
        process.exit(1);
    }

    if (!fs.statSync(scanDir).isDirectory()) {
        console.error(`Error: not a directory: ${scanDir}`);
        process.exit(1);
    }

    console.log(`Scanning directory: ${scanDir}`);
    console.log(`Database path: ${config.dbPath}`);
    console.log();

    // Find all org files
    const orgFiles = findOrgFiles(scanDir);
    console.log(`Found ${orgFiles.length} org file(s) to index.`);
    console.log();

    if (orgFiles.length === 0) {
        console.log('No org files found.');
        return;
    }

    const db = await createCliDatabase(config.dbPath);

    try {
        let indexed = 0;
        let errors = 0;

        for (const filePath of orgFiles) {
            const relativePath = path.relative(scanDir, filePath);
            process.stdout.write(`  Indexing: ${relativePath}...`);

            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const legacyDoc = parseToLegacyFormat(content);

                // Convert LegacyDocument to CliDocument format
                const cliDoc: CliDocument = {
                    headings: flattenHeadings(legacyDoc.headings).map(h => ({
                        level: h.level,
                        title: h.title,
                        lineNumber: h.lineNumber,
                        todoState: h.todoState,
                        priority: h.priority,
                        tags: h.tags,
                        properties: h.properties,
                    })),
                    sourceBlocks: legacyDoc.sourceBlocks.map(b => ({
                        language: b.language,
                        content: b.content,
                        lineNumber: b.lineNumber,
                        headers: b.headers,
                    })),
                    links: legacyDoc.links.map(l => ({
                        type: l.type,
                        target: l.target,
                        description: l.description,
                        lineNumber: l.lineNumber,
                    })),
                };

                await db.indexFile(filePath, cliDoc);
                indexed++;
                console.log(' OK');
            } catch (err) {
                errors++;
                console.log(` ERROR: ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        console.log();
        console.log(`Indexed: ${indexed} file(s)`);
        if (errors > 0) {
            console.log(`Errors: ${errors} file(s)`);
        }
    } finally {
        await db.close();
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
