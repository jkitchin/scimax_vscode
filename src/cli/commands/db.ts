/**
 * Database command - sync, clear, stats, maintenance
 *
 * Uses the same settings as the VS Code extension for consistent behavior.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { minimatch } from 'minimatch';
import { createCliDatabase, createCliEmbeddingService, testCliEmbeddingService } from '../database';
import {
    loadSettings,
    expandPath,
    findOrgFiles,
    getDirectoriesToScan,
    getVSCodeSettingsPath
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
        case 'sync':
            await syncDatabase(config, args);
            break;
        case 'clear':
            await clearDatabase(config, args);
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
        case 'rebuild':
        case 'reindex':
            console.error(`'scimax db ${subcommand}' has been removed.`);
            console.error(`Use 'scimax db sync' to bring the database in sync with the filesystem.`);
            console.error(`Use 'scimax db clear' followed by 'scimax db sync' for a full rebuild.`);
            process.exit(2);
            break;
        default:
            console.log(`
scimax db - Database operations

USAGE:
    scimax db stats                Show database statistics
    scimax db sync                 Discover, refresh, and prune in one pass
    scimax db clear                Wipe the database (requires --yes or confirm)
    scimax db scan <dir>           Scan a specific directory and add to database
    scimax db check                Check for stale/missing entries
    scimax db remove <file|glob>   Remove file(s) from the database
    scimax db ignore <file|glob>   Remove file(s) from DB and add to exclude list

OPTIONS:
    --dry-run          Compute and print the sync plan without changing the DB
    --verbose          Show per-file actions during sync
    --yes              Skip the confirmation prompt for clear
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
 * Action assigned to each file when sync reconciles disk and DB state.
 */
type SyncAction = 'new' | 'updated' | 'unchanged' | 'out-of-scope-refresh' | 'out-of-scope-skip' | 'removed';

interface SyncEntry {
    path: string;
    action: SyncAction;
}

interface DbFileSlim {
    path: string;
    mtime: number;
}

interface DiskFileSlim {
    path: string;
    mtimeMs: number;
}

/** Treat mtime differences below 1s as noise (matches the legacy reindex behavior). */
const MTIME_EPSILON_MS = 1000;

/**
 * Pure classification: given the files discovered under the active scan roots
 * and the files currently in the DB (plus a stat function for resolving
 * out-of-scope DB entries), produce one entry per affected file.
 *
 * Exported for unit testing.
 */
export function classifyForSync(
    diskFiles: DiskFileSlim[],
    dbFiles: DbFileSlim[],
    statOutOfScope: (filePath: string) => { mtimeMs: number } | null
): SyncEntry[] {
    const dbByPath = new Map(dbFiles.map(f => [f.path, f]));
    const diskByPath = new Map(diskFiles.map(f => [f.path, f]));
    const entries: SyncEntry[] = [];

    for (const disk of diskFiles) {
        const db = dbByPath.get(disk.path);
        if (!db) {
            entries.push({ path: disk.path, action: 'new' });
        } else if (Math.abs(disk.mtimeMs - db.mtime) >= MTIME_EPSILON_MS) {
            entries.push({ path: disk.path, action: 'updated' });
        } else {
            entries.push({ path: disk.path, action: 'unchanged' });
        }
    }

    for (const db of dbFiles) {
        if (diskByPath.has(db.path)) continue;
        const stat = statOutOfScope(db.path);
        if (stat === null) {
            entries.push({ path: db.path, action: 'removed' });
        } else if (Math.abs(stat.mtimeMs - db.mtime) >= MTIME_EPSILON_MS) {
            entries.push({ path: db.path, action: 'out-of-scope-refresh' });
        } else {
            entries.push({ path: db.path, action: 'out-of-scope-skip' });
        }
    }

    return entries;
}

function statSyncOrNull(filePath: string): { mtimeMs: number } | null {
    try {
        const s = fs.statSync(filePath);
        if (!s.isFile()) return null;
        return { mtimeMs: s.mtimeMs };
    } catch {
        return null;
    }
}

function homeDisplay(p: string): string {
    const home = process.env.HOME || '';
    return home && p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

/**
 * Bring the database into agreement with configured scan roots and the
 * filesystem: discover new files, refresh changed ones, and prune entries
 * for files that no longer exist.
 */
async function syncDatabase(config: CliConfig, args: ParsedArgs): Promise<void> {
    const dryRun = !!args.flags['dry-run'];
    const verbose = !!args.flags.verbose;
    const start = Date.now();

    const settings = loadSettings();
    const roots = getDirectoriesToScan(settings);

    console.log(`Database: ${config.dbPath}`);
    if (dryRun) console.log('Mode: dry-run (no changes will be written)');
    console.log();

    if (roots.length === 0) {
        console.log('No scan roots found. Configure at least one of:');
        console.log('  - scimax.db.include (VS Code settings)');
        console.log('  - scimax.journal.directory');
        console.log('  - scimax.agenda.include');
        console.log('  - A NotebookManager project (open a project folder in VS Code)');
        return;
    }

    console.log(`Scan roots (${roots.length}):`);
    for (const r of roots) console.log(`  ${homeDisplay(r)}`);
    console.log();

    const discovered: DiskFileSlim[] = [];
    const seenDisk = new Set<string>();
    for (const root of roots) {
        const found = findOrgFiles(root, settings.db.exclude, { maxFileSizeMB: settings.db.maxFileSizeMB });
        for (const filePath of found) {
            if (seenDisk.has(filePath)) continue;
            seenDisk.add(filePath);
            const s = statSyncOrNull(filePath);
            if (s !== null) discovered.push({ path: filePath, mtimeMs: s.mtimeMs });
        }
    }

    const db = await createCliDatabase(config.dbPath);

    let updateEmbeddings = false;
    if (args.flags['no-embeddings']) {
        console.log('Embeddings: disabled (--no-embeddings)');
    } else if (args.flags.embeddings || settings.embedding.provider !== 'none') {
        const embeddingService = createCliEmbeddingService(settings.embedding);
        if (embeddingService) {
            process.stdout.write('Testing embedding service connection...');
            const ok = await testCliEmbeddingService(embeddingService);
            if (ok) {
                updateEmbeddings = true;
                db.setEmbeddingService(embeddingService);
                console.log(' OK');
                console.log(`  Provider: ${settings.embedding.provider}, Model: ${settings.embedding.ollamaModel}`);
            } else {
                console.log(' FAILED (embeddings will be skipped)');
            }
        }
    }
    console.log();

    try {
        const dbFiles = await db.getFiles();
        const dbSlim: DbFileSlim[] = dbFiles.map(f => ({ path: f.path, mtime: f.mtime }));

        const entries = classifyForSync(discovered, dbSlim, statSyncOrNull);

        let added = 0;
        let updated = 0;
        let unchanged = 0;
        let refreshedOutOfScope = 0;
        let skippedOutOfScope = 0;
        let removed = 0;
        let errors = 0;

        for (const entry of entries) {
            const display = homeDisplay(entry.path);
            switch (entry.action) {
                case 'unchanged':
                    unchanged++;
                    if (verbose) console.log(`  =  ${display}`);
                    break;
                case 'out-of-scope-skip':
                    skippedOutOfScope++;
                    if (verbose) console.log(`  .  ${display} (out of scope, unchanged)`);
                    break;
                case 'new':
                case 'updated':
                case 'out-of-scope-refresh': {
                    const sigil = entry.action === 'new' ? '+' : entry.action === 'updated' ? '~' : '*';
                    if (verbose) {
                        const note = entry.action === 'out-of-scope-refresh' ? ' (out of scope, mtime newer)' : '';
                        console.log(`  ${sigil}  ${display}${note}`);
                    }
                    if (!dryRun) {
                        try {
                            await db.indexFile(entry.path, { queueEmbeddings: updateEmbeddings });
                            if (entry.action === 'new') added++;
                            else if (entry.action === 'updated') updated++;
                            else refreshedOutOfScope++;
                        } catch (err) {
                            errors++;
                            console.error(`  ! ${display}: ${err instanceof Error ? err.message : String(err)}`);
                        }
                    } else {
                        if (entry.action === 'new') added++;
                        else if (entry.action === 'updated') updated++;
                        else refreshedOutOfScope++;
                    }
                    break;
                }
                case 'removed':
                    if (verbose) console.log(`  -  ${display}`);
                    if (!dryRun) {
                        try {
                            await db.removeFile(entry.path);
                            removed++;
                        } catch (err) {
                            errors++;
                            console.error(`  ! ${display}: ${err instanceof Error ? err.message : String(err)}`);
                        }
                    } else {
                        removed++;
                    }
                    break;
            }
        }

        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log();
        console.log(`${dryRun ? 'sync (dry-run) plan' : 'sync complete'} in ${elapsed}s`);
        console.log(`  +${added} new`);
        console.log(`  ~${updated} updated`);
        if (refreshedOutOfScope > 0) console.log(`  *${refreshedOutOfScope} refreshed (out of scope)`);
        console.log(`  -${removed} removed`);
        console.log(`  ${unchanged} unchanged`);
        if (skippedOutOfScope > 0) console.log(`  ${skippedOutOfScope} out-of-scope unchanged`);
        if (updateEmbeddings && !dryRun) console.log(`  embeddings queued for changed files`);
        if (errors > 0) console.log(`  ${errors} error(s)`);
    } finally {
        await db.close();
    }
}

async function promptYesNo(question: string): Promise<boolean> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = await new Promise<string>(resolve => rl.question(question, resolve));
        return /^(y|yes)$/i.test(answer.trim());
    } finally {
        rl.close();
    }
}

async function clearDatabase(config: CliConfig, args: ParsedArgs): Promise<void> {
    if (!fs.existsSync(config.dbPath)) {
        console.log(`Database not found: ${config.dbPath}`);
        console.log('Nothing to clear.');
        return;
    }

    const db = await createCliDatabase(config.dbPath);
    try {
        const stats = await db.getStats();
        console.log(`Database: ${config.dbPath}`);
        console.log(`This will delete ${stats.files} file(s), ${stats.headings} heading(s), ${stats.blocks} source block(s).`);

        const skipPrompt = !!args.flags.yes;
        if (!skipPrompt) {
            const ok = await promptYesNo('Continue? [y/N] ');
            if (!ok) {
                console.log('Aborted.');
                return;
            }
        }

        await db.clear();
        console.log('Database cleared.');
        console.log('Run "scimax db sync" to repopulate.');
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
