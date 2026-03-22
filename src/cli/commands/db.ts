/**
 * Database command - rebuild, stats, maintenance
 *
 * Uses the same settings as the VS Code extension for consistent behavior.
 */

import * as fs from 'fs';
import * as path from 'path';
import { minimatch } from 'minimatch';
import { createCliDatabase, createCliEmbeddingService, testCliEmbeddingService } from '../database';
import type { ScimaxDbCore } from '../../database/scimaxDbCore';
import {
    loadSettings,
    expandPath,
    shouldExclude,
    findOrgFiles,
    getDirectoriesToScan,
    getVSCodeSettingsPath,
    ScimaxSettings
} from '../settings';

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
            await showStats(config, args);
            break;
        case 'check':
            await checkDatabase(config);
            break;
        case 'remove':
            await removeFile(config, args);
            break;
        case 'ignore':
            await ignoreFile(config, args);
            break;
        default:
            console.log(`
scimax db - Database operations

USAGE:
    scimax db stats             Show database statistics
    scimax db reindex           Re-index changed files (skips unchanged by mtime)
    scimax db rebuild           Rebuild database from org files
    scimax db scan <dir>        Scan a specific directory and add to database
    scimax db check             Check for stale/missing entries
    scimax db remove <file|glob>   Remove file(s) from the database
    scimax db ignore <file|glob>   Remove file(s) from DB and add to exclude list

OPTIONS:
    --path <dir>       Directory to scan (default: current) [for rebuild]
    --force            Force reindex of all files (ignore mtime)
    --embeddings       Also update embeddings (requires Ollama configured)
    --no-embeddings    Skip embedding generation
    --json             Output JSON (stats, remove, ignore)
`);
    }
}

async function showStats(config: CliConfig, args: ParsedArgs): Promise<void> {
    const db = await createCliDatabase(config.dbPath);
    const json = args.flags.json === true;

    try {
        const stats = await db.getStats();

        if (json) {
            console.log(JSON.stringify({
                db_path: config.dbPath,
                root_dir: config.rootDir,
                files: stats.files,
                headings: stats.headings,
                blocks: stats.blocks,
                has_embeddings: stats.has_embeddings,
                by_type: stats.by_type || null,
            }, null, 2));
        } else {
            console.log('=== Database Statistics ===\n');
            console.log(`  Database: ${config.dbPath}`);
            console.log(`  Root: ${config.rootDir}`);
            console.log();
            console.log(`  Files indexed: ${stats.files}`);
            console.log(`  Headings: ${stats.headings}`);
            console.log(`  Source blocks: ${stats.blocks}`);
            console.log(`  Has embeddings: ${stats.has_embeddings ? 'Yes' : 'No'}`);
            if (stats.by_type) {
                console.log(`  Org files: ${stats.by_type.org}`);
                console.log(`  Markdown files: ${stats.by_type.md}`);
            }
        }
    } finally {
        await db.close();
    }
}

/**
 * Re-index all files already in the database.
 */
async function reindexFiles(config: CliConfig, args: ParsedArgs): Promise<void> {
    console.log(`Database path: ${config.dbPath}`);
    console.log();

    const settings = loadSettings();
    const db = await createCliDatabase(config.dbPath);

    // Setup embedding service
    let updateEmbeddings = false;

    if (args.flags['no-embeddings']) {
        console.log('Embeddings: Disabled (--no-embeddings flag)');
    } else if (args.flags.embeddings || settings.embedding.provider !== 'none') {
        const embeddingService = createCliEmbeddingService(settings.embedding);
        if (embeddingService) {
            process.stdout.write('Testing embedding service connection...');
            const ok = await testCliEmbeddingService(embeddingService);
            if (ok) {
                updateEmbeddings = true;
                db.setEmbeddingService(embeddingService);
                console.log(' OK');
                console.log(`  Provider: ${settings.embedding.provider}`);
                console.log(`  Model: ${settings.embedding.ollamaModel}`);
                console.log(`  Dimensions: ${embeddingService.dimensions}`);
            } else {
                console.log(' FAILED');
                console.log('  Embeddings will be skipped. Is Ollama running?');
            }
        } else {
            console.log('Embeddings: No provider configured');
        }
    } else {
        console.log('Embeddings: Disabled (no provider configured)');
    }
    console.log();

    const forceReindex = !!args.flags.force;
    if (forceReindex) {
        console.log('Force mode: will reindex all files regardless of mtime');
        console.log();
    }

    try {
        // Get all files already in the database using getFiles()
        const files = await db.getFiles();
        console.log(`Found ${files.length} file(s) in database.`);
        console.log();

        if (files.length === 0) {
            console.log('No files to reindex. Use "scimax db scan <dir>" to add files.');
            return;
        }

        let indexed = 0;
        let skipped = 0;
        let deleted = 0;
        let errors = 0;
        let embeddingsGenerated = 0;

        for (const file of files) {
            const filePath = file.path;
            const displayPath = filePath.replace(process.env.HOME || '', '~');

            // Check if file still exists
            if (!fs.existsSync(filePath)) {
                process.stdout.write(`  Removing (missing): ${displayPath}...`);
                try {
                    await db.removeFile(filePath);
                    deleted++;
                    console.log(' OK');
                } catch (err) {
                    console.log(` ERROR: ${err instanceof Error ? err.message : String(err)}`);
                }
                continue;
            }

            // Check if file has changed (by mtime) unless --force is set
            if (!forceReindex && file.mtime) {
                try {
                    const stats = fs.statSync(filePath);
                    if (Math.abs(stats.mtimeMs - file.mtime) < 1000) {
                        skipped++;
                        continue;
                    }
                } catch {
                    // If we can't stat, proceed with reindexing
                }
            }

            process.stdout.write(`  Indexing: ${displayPath}...`);

            try {
                // Use ScimaxDbCore.indexFile directly - it handles parsing internally
                await db.indexFile(filePath, { queueEmbeddings: updateEmbeddings });
                indexed++;

                if (updateEmbeddings) {
                    // indexFile with queueEmbeddings=true already queued it
                    embeddingsGenerated++;
                    console.log(' OK (+embeddings queued)');
                } else {
                    console.log(' OK');
                }
            } catch (err) {
                errors++;
                console.log(` ERROR: ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        console.log();
        console.log(`Indexed: ${indexed} file(s)`);
        if (skipped > 0) console.log(`Skipped (unchanged): ${skipped} file(s)`);
        if (updateEmbeddings) console.log(`Embeddings queued: ${embeddingsGenerated} file(s)`);
        if (deleted > 0) console.log(`Removed (missing): ${deleted} file(s)`);
        if (errors > 0) console.log(`Errors: ${errors} file(s)`);
    } finally {
        await db.close();
    }
}

async function rebuildDatabase(config: CliConfig, args: ParsedArgs): Promise<void> {
    console.log(`Database path: ${config.dbPath}`);
    console.log();

    const settings = loadSettings();

    console.log('Using exclude patterns:');
    for (const pattern of settings.db.exclude) {
        console.log(`  ${pattern}`);
    }
    console.log();

    // Collect directories to scan
    const directoriesToScan: string[] = [];

    if (typeof args.flags.path === 'string') {
        directoriesToScan.push(path.resolve(args.flags.path));
        console.log('Scanning specified directory:');
    } else {
        console.log('Discovering directories to scan...');
        const configDirs = getDirectoriesToScan(settings);
        if (configDirs.length > 0) {
            console.log(`  From VS Code settings: ${configDirs.length} directories`);
            directoriesToScan.push(...configDirs);
        }
        if (directoriesToScan.length === 0) {
            console.log('  No configured directories found, using current directory');
            console.log('  Tip: Set scimax.db.include in VS Code settings to specify directories.');
            directoriesToScan.push(config.rootDir);
        }
    }

    const uniqueDirs = [...new Set(directoriesToScan)].filter(dir => {
        if (!fs.existsSync(dir)) { console.log(`  Skipping (not found): ${dir}`); return false; }
        if (!fs.statSync(dir).isDirectory()) { console.log(`  Skipping (not a directory): ${dir}`); return false; }
        return true;
    });

    console.log();
    console.log('Directories to scan:');
    for (const dir of uniqueDirs) console.log(`  ${dir}`);
    console.log();

    const allOrgFiles: string[] = [];
    for (const dir of uniqueDirs) {
        const files = findOrgFiles(dir, settings.db.exclude, { maxFileSizeMB: settings.db.maxFileSizeMB });
        allOrgFiles.push(...files);
    }
    const orgFiles = [...new Set(allOrgFiles)];
    console.log(`Found ${orgFiles.length} org file(s) to index.`);
    console.log();

    if (orgFiles.length === 0) {
        console.log('No org files found.');
        return;
    }

    const db = await createCliDatabase(config.dbPath);

    // Setup embedding service
    let updateEmbeddings = false;
    if (args.flags['no-embeddings']) {
        console.log('Embeddings: Disabled (--no-embeddings flag)');
    } else if (args.flags.embeddings || settings.embedding.provider !== 'none') {
        const embeddingService = createCliEmbeddingService(settings.embedding);
        if (embeddingService) {
            process.stdout.write('Testing embedding service connection...');
            const ok = await testCliEmbeddingService(embeddingService);
            if (ok) {
                updateEmbeddings = true;
                db.setEmbeddingService(embeddingService);
                console.log(' OK');
                console.log(`  Provider: ${settings.embedding.provider}`);
                console.log(`  Model: ${settings.embedding.ollamaModel}`);
            } else {
                console.log(' FAILED');
                console.log('  Embeddings will be skipped. Is Ollama running?');
            }
        }
    }
    console.log();

    try {
        let indexed = 0;
        let errors = 0;

        for (const filePath of orgFiles) {
            const displayPath = filePath.replace(process.env.HOME || '', '~');
            process.stdout.write(`  Indexing: ${displayPath}...`);

            try {
                // ScimaxDbCore.indexFile handles all parsing and insertion internally
                await db.indexFile(filePath, { queueEmbeddings: updateEmbeddings });
                indexed++;
                console.log(updateEmbeddings ? ' OK (+embeddings queued)' : ' OK');
            } catch (err) {
                errors++;
                console.log(` ERROR: ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        console.log();
        console.log(`Indexed: ${indexed} file(s)`);
        if (updateEmbeddings) console.log(`Embeddings queued for async processing.`);
        if (errors > 0) console.log(`Errors: ${errors} file(s)`);
    } finally {
        await db.close();
    }
}

async function scanDirectory(config: CliConfig, args: ParsedArgs): Promise<void> {
    const dirArg = args.args[1];

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

    const settings = loadSettings();

    console.log(`Scanning directory: ${scanDir}`);
    console.log(`Database path: ${config.dbPath}`);
    console.log();

    console.log('Using exclude patterns:');
    for (const pattern of settings.db.exclude) console.log(`  ${pattern}`);
    console.log();

    const orgFiles = findOrgFiles(scanDir, settings.db.exclude, { maxFileSizeMB: settings.db.maxFileSizeMB });
    console.log(`Found ${orgFiles.length} org file(s) to index.`);
    console.log();

    if (orgFiles.length === 0) {
        console.log('No org files found.');
        return;
    }

    const db = await createCliDatabase(config.dbPath);

    // Setup embedding service
    let updateEmbeddings = false;
    if (args.flags['no-embeddings']) {
        console.log('Embeddings: Disabled (--no-embeddings flag)');
    } else if (args.flags.embeddings || settings.embedding.provider !== 'none') {
        const embeddingService = createCliEmbeddingService(settings.embedding);
        if (embeddingService) {
            process.stdout.write('Testing embedding service connection...');
            const ok = await testCliEmbeddingService(embeddingService);
            if (ok) {
                updateEmbeddings = true;
                db.setEmbeddingService(embeddingService);
                console.log(' OK');
                console.log(`  Provider: ${settings.embedding.provider}`);
                console.log(`  Model: ${settings.embedding.ollamaModel}`);
            } else {
                console.log(' FAILED');
                console.log('  Embeddings will be skipped. Is Ollama running?');
            }
        }
    }
    console.log();

    try {
        let indexed = 0;
        let errors = 0;

        for (const filePath of orgFiles) {
            const relativePath = path.relative(scanDir, filePath);
            process.stdout.write(`  Indexing: ${relativePath}...`);

            try {
                await db.indexFile(filePath, { queueEmbeddings: updateEmbeddings });
                indexed++;
                console.log(updateEmbeddings ? ' OK (+embeddings queued)' : ' OK');
            } catch (err) {
                errors++;
                console.log(` ERROR: ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        console.log();
        console.log(`Indexed: ${indexed} file(s)`);
        if (updateEmbeddings) console.log(`Embeddings queued for async processing.`);
        if (errors > 0) console.log(`Errors: ${errors} file(s)`);
    } finally {
        await db.close();
    }
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

        const files = await db.getFiles();
        let missing = 0;

        for (const file of files) {
            if (!fs.existsSync(file.path)) {
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

/**
 * Return true if the string contains glob metacharacters.
 */
function isGlob(pattern: string): boolean {
    return /[*?[\]{!]/.test(pattern);
}

/**
 * Expand ~ and resolve to absolute path, but preserve glob metacharacters
 * so minimatch can use them.
 */
function resolvePattern(pattern: string): string {
    return expandPath(pattern.startsWith('/') || pattern.startsWith('~')
        ? pattern
        : path.join(process.cwd(), pattern));
}

/**
 * Match a list of absolute file paths against a pattern.
 * If the pattern is a glob, use minimatch; otherwise exact-match.
 */
function matchFiles(allPaths: string[], pattern: string): string[] {
    const resolved = resolvePattern(pattern);
    if (isGlob(resolved)) {
        return allPaths.filter(p => minimatch(p, resolved, { dot: true }));
    }
    return allPaths.filter(p => p === resolved);
}

async function removeFile(config: CliConfig, args: ParsedArgs): Promise<void> {
    const fileArg = args.args[1];
    const json = args.flags.json === true;

    if (!fileArg) {
        console.error('Error: remove requires a file argument');
        console.error('Usage: scimax db remove <file|glob>');
        process.exit(1);
    }

    const db = await createCliDatabase(config.dbPath);

    try {
        const files = await db.getFiles();
        const allPaths = files.map(f => f.path);
        const matched = matchFiles(allPaths, fileArg);

        if (matched.length === 0) {
            if (json) {
                console.log(JSON.stringify({ success: false, pattern: fileArg, error: 'No matching files found in database' }));
            } else {
                console.error(`No matching files in database: ${fileArg}`);
            }
            process.exit(1);
        }

        for (const filePath of matched) {
            await db.removeFile(filePath);
            if (!json) {
                console.log(`Removed from database: ${filePath}`);
            }
        }

        if (json) {
            console.log(JSON.stringify({ success: true, pattern: fileArg, removed: matched }));
        } else if (matched.length > 1) {
            console.log(`\nRemoved ${matched.length} file(s) from database.`);
        }
    } finally {
        await db.close();
    }
}

/**
 * Add a pattern to scimax.db.exclude in VS Code settings.json.
 * Returns the updated exclude list, or throws on failure.
 */
function addToSettingsExclude(pattern: string): string[] {
    const settingsPath = getVSCodeSettingsPath();
    let rawSettings: Record<string, unknown> = {};

    if (fs.existsSync(settingsPath)) {
        const content = fs.readFileSync(settingsPath, 'utf-8');
        try {
            const stripped = content
                .replace(/\/\/.*$/gm, '')
                .replace(/\/\*[\s\S]*?\*\//g, '');
            rawSettings = JSON.parse(stripped);
        } catch {
            throw new Error(`Could not parse ${settingsPath}. Edit scimax.db.exclude manually.`);
        }
    }

    const exclude: string[] = Array.isArray(rawSettings['scimax.db.exclude'])
        ? rawSettings['scimax.db.exclude'] as string[]
        : [];

    if (!exclude.includes(pattern)) {
        exclude.push(pattern);
        rawSettings['scimax.db.exclude'] = exclude;
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify(rawSettings, null, 2));
    }

    return exclude;
}

async function ignoreFile(config: CliConfig, args: ParsedArgs): Promise<void> {
    const fileArg = args.args[1];
    const json = args.flags.json === true;

    if (!fileArg) {
        console.error('Error: ignore requires a file argument');
        console.error('Usage: scimax db ignore <file|glob>');
        process.exit(1);
    }

    const db = await createCliDatabase(config.dbPath);

    try {
        // Find matching files in DB and remove them
        const files = await db.getFiles();
        const allPaths = files.map(f => f.path);
        const matched = matchFiles(allPaths, fileArg);

        for (const filePath of matched) {
            await db.removeFile(filePath);
            if (!json) {
                console.log(`Removed from database: ${filePath}`);
            }
        }

        if (!json && matched.length === 0) {
            console.log(`Not in database (skipped removal): ${fileArg}`);
        }

        // For the exclude list: add the pattern as-is (glob) or resolved absolute path (exact)
        const excludeEntry = isGlob(fileArg) ? expandPath(fileArg) : resolvePattern(fileArg);

        let settingsUpdated = false;
        let settingsError: string | undefined;
        try {
            addToSettingsExclude(excludeEntry);
            settingsUpdated = true;
        } catch (err) {
            settingsError = err instanceof Error ? err.message : String(err);
        }

        if (json) {
            console.log(JSON.stringify({
                success: true,
                pattern: fileArg,
                removed_from_db: matched,
                exclude_entry: excludeEntry,
                added_to_exclude: settingsUpdated,
                settings_error: settingsError || null,
            }));
        } else {
            if (settingsUpdated) {
                console.log(`Added to scimax.db.exclude: "${excludeEntry}"`);
            } else {
                console.error(`Warning: Could not update settings.json: ${settingsError}`);
                console.error(`Add manually: "${excludeEntry}" to scimax.db.exclude`);
            }
            if (matched.length > 1) {
                console.log(`\nRemoved ${matched.length} file(s) from database.`);
            }
        }
    } finally {
        await db.close();
    }
}
