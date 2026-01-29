/**
 * Database command - rebuild, stats, maintenance
 */

import * as fs from 'fs';
import * as path from 'path';
import { createCliDatabase, CliDocument } from '../database';
import { parseToLegacyFormat, flattenHeadings, LegacyHeading } from '../../parser/orgParserAdapter';

/**
 * Extract scheduling info (SCHEDULED, DEADLINE, CLOSED) for a heading
 * by scanning the lines after the heading. Matches VS Code extension behavior.
 */
function extractSchedulingInfo(
    heading: LegacyHeading,
    lines: string[]
): { scheduled?: string; deadline?: string; closed?: string } {
    const headingLine = heading.lineNumber - 1; // Convert to 0-indexed
    let scheduled: string | undefined;
    let deadline: string | undefined;
    let closed: string | undefined;

    // Scan up to 5 lines after heading for scheduling info
    for (let i = headingLine + 1; i < Math.min(headingLine + 5, lines.length); i++) {
        const line = lines[i];
        // Stop if we hit another heading
        if (line.match(/^\*+\s/)) break;

        const schedMatch = line.match(/SCHEDULED:\s*<(\d{4}-\d{2}-\d{2}[^>]*)>/);
        if (schedMatch) scheduled = schedMatch[1];

        const deadMatch = line.match(/DEADLINE:\s*<(\d{4}-\d{2}-\d{2}[^>]*)>/);
        if (deadMatch) deadline = deadMatch[1];

        const closedMatch = line.match(/CLOSED:\s*\[(\d{4}-\d{2}-\d{2}[^\]]*)\]/);
        if (closedMatch) closed = closedMatch[1];
    }

    return { scheduled, deadline, closed };
}

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

/**
 * Get VS Code settings path for current platform
 */
function getVSCodeSettingsPath(): string {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const platform = process.platform;

    if (platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
    } else if (platform === 'win32') {
        return path.join(process.env.APPDATA || '', 'Code', 'User', 'settings.json');
    } else {
        return path.join(home, '.config', 'Code', 'User', 'settings.json');
    }
}

/**
 * Read VS Code settings and extract scimax-relevant paths
 */
function getConfiguredDirectories(): string[] {
    const dirs: string[] = [];
    const home = process.env.HOME || process.env.USERPROFILE || '';

    try {
        const settingsPath = getVSCodeSettingsPath();
        if (fs.existsSync(settingsPath)) {
            const content = fs.readFileSync(settingsPath, 'utf-8');
            // Remove comments (simple approach - doesn't handle all edge cases)
            const jsonContent = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
            const settings = JSON.parse(jsonContent);

            // Get scimax.db.include directories
            const includeDirs: string[] = settings['scimax.db.include'] || [];
            for (let dir of includeDirs) {
                if (dir.startsWith('~')) {
                    dir = dir.replace(/^~/, home);
                }
                if (fs.existsSync(dir)) {
                    dirs.push(dir);
                }
            }

            // Get journal directory
            let journalDir: string | undefined = settings['scimax.journal.directory'];
            if (journalDir) {
                if (journalDir.startsWith('~')) {
                    journalDir = journalDir.replace(/^~/, home);
                }
                if (fs.existsSync(journalDir)) {
                    dirs.push(journalDir);
                }
            }
        }
    } catch {
        // Ignore errors reading settings
    }

    return dirs;
}

/**
 * Get unique root directories from already-indexed files in the database.
 * Uses smart heuristics to find meaningful root directories rather than
 * individual file parents.
 */
async function getIndexedDirectories(dbPath: string): Promise<string[]> {
    const dirs = new Set<string>();
    const home = process.env.HOME || process.env.USERPROFILE || '';

    try {
        const db = await createCliDatabase(dbPath);
        const files = await db.getIndexedFiles();
        await db.close();

        for (const file of files) {
            const filePath = file.path;
            const fileDir = path.dirname(filePath);

            // Skip if path doesn't start with home (unusual case)
            if (!fileDir.startsWith(home)) {
                dirs.add(fileDir);
                continue;
            }

            // Get directory path relative to home
            const relDir = fileDir.slice(home.length + 1);
            const parts = relDir.split(path.sep).filter(p => p.length > 0);

            // Find the best root directory:
            // - For paths like ~/Dropbox/CMU/projects/..., use ~/Dropbox/CMU/projects
            // - For paths like ~/Documents/org/..., use ~/Documents/org
            // Generally: use 3 levels deep from home as the root

            if (parts.length >= 3) {
                // Use first 3 components (e.g., Dropbox/CMU/projects)
                const rootDir = path.join(home, parts[0], parts[1], parts[2]);
                if (fs.existsSync(rootDir) && fs.statSync(rootDir).isDirectory()) {
                    dirs.add(rootDir);
                    continue;
                }
            }

            if (parts.length >= 2) {
                // Use first 2 components (e.g., Dropbox/emacs)
                const rootDir = path.join(home, parts[0], parts[1]);
                if (fs.existsSync(rootDir) && fs.statSync(rootDir).isDirectory()) {
                    dirs.add(rootDir);
                    continue;
                }
            }

            // Fallback: use immediate parent directory
            dirs.add(fileDir);
        }
    } catch {
        // Database might not exist yet
    }

    return Array.from(dirs);
}

export async function dbCommand(config: CliConfig, args: ParsedArgs): Promise<void> {
    const subcommand = args.subcommand || 'stats';

    switch (subcommand) {
        case 'reindex':
            await reindexFiles(config, args);
            break;
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
    scimax db reindex           Re-index all files already in the database
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

/**
 * Re-index all files already in the database.
 * This is the simplest and most accurate way to refresh the index.
 */
async function reindexFiles(config: CliConfig, args: ParsedArgs): Promise<void> {
    console.log(`Database path: ${config.dbPath}`);
    console.log();

    const db = await createCliDatabase(config.dbPath);

    try {
        // Get all files already in the database
        const files = await db.getIndexedFiles();
        console.log(`Found ${files.length} file(s) in database.`);
        console.log();

        if (files.length === 0) {
            console.log('No files to reindex. Use "scimax db scan <dir>" to add files.');
            return;
        }

        let indexed = 0;
        let deleted = 0;
        let errors = 0;

        for (const file of files) {
            const filePath = file.path;
            const displayPath = filePath.replace(process.env.HOME || '', '~');

            // Check if file still exists - if not, delete from database
            if (!fs.existsSync(filePath)) {
                process.stdout.write(`  Removing (missing): ${displayPath}...`);
                try {
                    await db.clearFile(filePath);
                    deleted++;
                    console.log(' OK');
                } catch (err) {
                    console.log(` ERROR: ${err instanceof Error ? err.message : String(err)}`);
                }
                continue;
            }

            process.stdout.write(`  Indexing: ${displayPath}...`);

            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const lines = content.split('\n');
                const legacyDoc = parseToLegacyFormat(content);

                const cliDoc: CliDocument = {
                    headings: flattenHeadings(legacyDoc.headings).map(h => {
                        const scheduling = extractSchedulingInfo(h, lines);
                        return {
                            level: h.level,
                            title: h.title,
                            lineNumber: h.lineNumber,
                            todoState: h.todoState,
                            priority: h.priority,
                            tags: h.tags,
                            properties: h.properties,
                            scheduled: scheduling.scheduled,
                            deadline: scheduling.deadline,
                            closed: scheduling.closed,
                        };
                    }),
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
        if (deleted > 0) {
            console.log(`Removed (missing): ${deleted} file(s)`);
        }
        if (errors > 0) {
            console.log(`Errors: ${errors} file(s)`);
        }
    } finally {
        await db.close();
    }
}

async function rebuildDatabase(config: CliConfig, args: ParsedArgs): Promise<void> {
    console.log(`Database path: ${config.dbPath}`);
    console.log();

    // Collect directories to scan
    const directoriesToScan: string[] = [];

    // If --path is specified, only scan that directory
    if (typeof args.flags.path === 'string') {
        directoriesToScan.push(path.resolve(args.flags.path));
        console.log('Scanning specified directory:');
    } else {
        // Auto-discover directories from multiple sources
        console.log('Discovering directories to scan...');

        // 1. From VS Code settings (scimax.db.include, scimax.journal.directory)
        const configDirs = getConfiguredDirectories();
        if (configDirs.length > 0) {
            console.log(`  From VS Code settings: ${configDirs.length} directories`);
            directoriesToScan.push(...configDirs);
        }

        // 2. From already-indexed files in the database
        const indexedDirs = await getIndexedDirectories(config.dbPath);
        if (indexedDirs.length > 0) {
            console.log(`  From existing database: ${indexedDirs.length} directories`);
            directoriesToScan.push(...indexedDirs);
        }

        // 3. Current directory as fallback
        if (directoriesToScan.length === 0) {
            console.log('  No configured directories found, using current directory');
            directoriesToScan.push(config.rootDir);
        }
    }

    // Deduplicate and filter to existing directories
    const uniqueDirs = [...new Set(directoriesToScan)].filter(dir => {
        if (!fs.existsSync(dir)) {
            console.log(`  Skipping (not found): ${dir}`);
            return false;
        }
        if (!fs.statSync(dir).isDirectory()) {
            console.log(`  Skipping (not a directory): ${dir}`);
            return false;
        }
        return true;
    });

    console.log();
    console.log('Directories to scan:');
    for (const dir of uniqueDirs) {
        console.log(`  ${dir}`);
    }
    console.log();

    // Find all org files across all directories
    const allOrgFiles: string[] = [];
    for (const dir of uniqueDirs) {
        const files = findOrgFiles(dir);
        allOrgFiles.push(...files);
    }

    // Deduplicate files (in case directories overlap)
    const orgFiles = [...new Set(allOrgFiles)];
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
            // Show just filename for cleaner output
            const displayPath = filePath.replace(process.env.HOME || '', '~');
            process.stdout.write(`  Indexing: ${displayPath}...`);

            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const lines = content.split('\n');
                const legacyDoc = parseToLegacyFormat(content);

                // Convert LegacyDocument to CliDocument format
                const cliDoc: CliDocument = {
                    headings: flattenHeadings(legacyDoc.headings).map(h => {
                        const scheduling = extractSchedulingInfo(h, lines);
                        return {
                            level: h.level,
                            title: h.title,
                            lineNumber: h.lineNumber,
                            todoState: h.todoState,
                            priority: h.priority,
                            tags: h.tags,
                            properties: h.properties,
                            scheduled: scheduling.scheduled,
                            deadline: scheduling.deadline,
                            closed: scheduling.closed,
                        };
                    }),
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
                const lines = content.split('\n');
                const legacyDoc = parseToLegacyFormat(content);

                // Convert LegacyDocument to CliDocument format
                const cliDoc: CliDocument = {
                    headings: flattenHeadings(legacyDoc.headings).map(h => {
                        const scheduling = extractSchedulingInfo(h, lines);
                        return {
                            level: h.level,
                            title: h.title,
                            lineNumber: h.lineNumber,
                            todoState: h.todoState,
                            priority: h.priority,
                            tags: h.tags,
                            properties: h.properties,
                            scheduled: scheduling.scheduled,
                            deadline: scheduling.deadline,
                            closed: scheduling.closed,
                        };
                    }),
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
