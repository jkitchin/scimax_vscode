#!/usr/bin/env node
/**
 * scope-db.js: set what the scimax database indexes, and drop everything else.
 *
 * Reads a scope file (JSON) listing the folders and files to index and the
 * patterns to exclude, then:
 *   1. writes it into VS Code's settings.json (scimax.db.include / exclude /
 *      includeProjects / includeWorkspace / includeJournal), and
 *   2. removes every indexed file outside that scope from the database,
 *      keeping the embeddings of files that stay.
 *
 * Dry run by default: prints what would be kept and removed, changes nothing.
 *
 *   node scripts/scope-db.js --config ~/Dropbox/scimax-db-scope.json
 *   node scripts/scope-db.js --config ~/Dropbox/scimax-db-scope.json --apply
 *
 * --apply needs VS Code closed (it refuses while another process has the
 * database open), backs up settings.json and the database first, and ends
 * with VACUUM to give the space back.
 *
 * Scope file:
 *   {
 *     "include": ["~/Dropbox/projects", "~/Dropbox/*.org"],  // dirs, files, or *-globs in one dir
 *     "exclude": ["**\/_build/**"],                          // added to the existing exclude list
 *     "includeJournal": true,      // scimax.journal.directory (default true)
 *     "includeProjects": false,    // every registered scimax project (default false)
 *     "includeWorkspace": false,   // whatever folder VS Code has open (default false)
 *     "fileExtensions": ["org", "md"]  // optional; else the current scimax.db.fileExtensions
 *   }
 *
 * Options:
 *   --config <file>    scope file (required)
 *   --apply            make the changes (default: dry run)
 *   --settings <file>  VS Code settings.json (default: platform location)
 *   --db <file>        database (default: VS Code globalStorage)
 *   --no-backup        skip the database backup (settings.json is always backed up)
 *   --force            skip the "database is open" check
 *
 * Runs from a scimax-vscode checkout (after `npm run compile`) or from the
 * installed extension; it uses the extension's own exclude and file-type
 * matching so the script and the extension agree on what is out of scope.
 */
/* global require, process, console, __dirname, __filename */
/* eslint-disable @typescript-eslint/no-var-requires -- plain CommonJS script, run with node */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOME = os.homedir();
const EXT_ID = 'jkitchin.scimax-vscode';

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
    const args = { apply: false, backup: true, force: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--apply') args.apply = true;
        else if (a === '--no-backup') args.backup = false;
        else if (a === '--force') args.force = true;
        else if (a === '--config') args.config = argv[++i];
        else if (a === '--settings') args.settings = argv[++i];
        else if (a === '--db') args.db = argv[++i];
        else if (a === '-h' || a === '--help') args.help = true;
        else throw new Error(`Unknown argument: ${a}`);
    }
    return args;
}

const expand = p => (p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);
const tilde = p => (p.startsWith(HOME + path.sep) ? '~' + p.slice(HOME.length) : p);

// ------------------------------------------------------------- dependencies

/** Directory holding out/ and node_modules/: this checkout, else the newest installed extension. */
function findExtensionRoot() {
    const candidates = [path.resolve(__dirname, '..')];
    for (const base of ['.vscode/extensions', '.vscode-insiders/extensions']) {
        const dir = path.join(HOME, base);
        if (!fs.existsSync(dir)) continue;
        const installed = fs.readdirSync(dir)
            .filter(n => n.startsWith(EXT_ID + '-'))
            .map(n => path.join(dir, n))
            .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        candidates.push(...installed);
    }
    for (const c of candidates) {
        if (fs.existsSync(path.join(c, 'out/shared/indexableFiles.js'))
            && fs.existsSync(path.join(c, 'node_modules/@libsql/client'))) return c;
    }
    throw new Error('Could not find a built scimax-vscode (out/ and node_modules/). '
        + 'Run `npm install && npm run compile` in the checkout, or install the extension.');
}

function tryRequire(root, mod) {
    try { return require(path.join(root, 'node_modules', mod)); } catch { return null; }
}

// ----------------------------------------------------------------- settings

function defaultSettingsPath() {
    if (process.platform === 'darwin') return path.join(HOME, 'Library/Application Support/Code/User/settings.json');
    if (process.platform === 'win32') return path.join(process.env.APPDATA || '', 'Code/User/settings.json');
    return path.join(HOME, '.config/Code/User/settings.json');
}

function defaultDbPath(settingsPath) {
    return path.join(path.dirname(settingsPath), 'globalStorage', EXT_ID, 'scimax-db.sqlite');
}

/** Lenient JSONC read (comments, trailing commas), as VS Code does. */
function readSettings(file, jsonc) {
    if (!fs.existsSync(file)) return { text: '{}', data: {} };
    const text = fs.readFileSync(file, 'utf8');
    if (jsonc) return { text, data: jsonc.parse(text, [], { allowTrailingComma: true }) || {} };
    return { text, data: JSON.parse(text) };
}

/** Expand an include entry: a dir, a file, or a *-glob within one directory. */
function expandInclude(entry, minimatch) {
    const p = expand(entry);
    if (!p.includes('*')) return fs.existsSync(p) ? [p] : [];
    const dir = path.dirname(p);
    if (dir.includes('*') || !fs.existsSync(dir)) return [];
    const base = path.basename(p);
    return fs.readdirSync(dir)
        .filter(n => minimatch(n, base))
        .map(n => path.join(dir, n));
}

// ------------------------------------------------------------------- report

function summarize(files) {
    return {
        files: files.length,
        chunks: files.reduce((s, f) => s + f.chunks, 0),
        todos: files.reduce((s, f) => s + f.todos, 0),
    };
}

function fmt(s) {
    return `${s.files.toLocaleString()} files, ${s.chunks.toLocaleString()} embedding chunks, ${s.todos.toLocaleString()} TODO headings`;
}

/** Group removed files by their first few path components, largest first. */
function groupByFolder(files, depth = 3) {
    const groups = new Map();
    for (const f of files) {
        const rel = tilde(f.path).split('/');
        const key = rel.slice(0, Math.min(depth + 1, rel.length - 1)).join('/');
        const g = groups.get(key) || { files: 0, todos: 0 };
        g.files++; g.todos += f.todos;
        groups.set(key, g);
    }
    return [...groups].sort((a, b) => b[1].files - a[1].files);
}

// ------------------------------------------------------------------ helpers

/** PIDs (other than ours) holding the database or its WAL open; null if lsof is unavailable. */
function openers(dbPath) {
    if (process.platform === 'win32') return null;
    try {
        const out = execFileSync('lsof', ['-t', dbPath, dbPath + '-wal'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        return [...new Set(out.split(/\s+/).filter(Boolean))].filter(p => p !== String(process.pid));
    } catch (e) {
        if (e.code === 'ENOENT') return null;  // no lsof
        return [];                              // lsof exits 1 when nothing has it open
    }
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

// --------------------------------------------------------------------- main

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !args.config) {
        console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*?/, '').replace(/^ \* ?/gm, ''));
        process.exit(args.help ? 0 : 2);
    }

    const root = findExtensionRoot();
    const { isExcludedPath } = require(path.join(root, 'out/shared/ignorePatterns.js'));
    const { DEFAULT_FILE_EXTENSIONS, isIndexableFile } = require(path.join(root, 'out/shared/indexableFiles.js'));
    const { createClient } = require(path.join(root, 'node_modules/@libsql/client'));
    const jsonc = tryRequire(root, 'jsonc-parser');
    const mm = tryRequire(root, 'minimatch');
    const minimatch = mm && (mm.minimatch || mm);

    const scope = JSON.parse(fs.readFileSync(expand(args.config), 'utf8'));
    const settingsPath = expand(args.settings || defaultSettingsPath());
    const dbPath = expand(args.db || defaultDbPath(settingsPath));
    const settings = readSettings(settingsPath, jsonc);

    // Resolve the scope exactly as the extension's collectIndexDirectories()
    // would with these settings.
    const includeJournal = scope.includeJournal ?? true;
    const includeProjects = scope.includeProjects ?? false;
    const includeWorkspace = scope.includeWorkspace ?? false;
    const include = [...new Set((scope.include || []).flatMap(e => expandInclude(e, minimatch)))];
    const missing = (scope.include || []).filter(e => expandInclude(e, minimatch).length === 0);
    const exclude = [...new Set([...(settings.data['scimax.db.exclude'] || []), ...(scope.exclude || [])])];
    const fileExtensions = scope.fileExtensions || settings.data['scimax.db.fileExtensions'] || [...DEFAULT_FILE_EXTENSIONS];

    const roots = [...include];
    if (includeJournal) {
        const scimaxDir = expand(settings.data['scimax.directory'] || '~/scimax');
        roots.push(expand(settings.data['scimax.journal.directory'] || path.join(scimaxDir, 'journal')));
    }
    if (includeProjects || includeWorkspace) {
        console.log('Note: includeProjects/includeWorkspace are on; files under projects or workspace');
        console.log('folders are not known to this script and will be removed here, then re-indexed by VS Code.\n');
    }

    const inScope = p => roots.some(r => p === r || p.startsWith(r + path.sep))
        && isIndexableFile(p, fileExtensions)
        && !isExcludedPath(p, exclude);

    console.log(`Database: ${tilde(dbPath)}`);
    console.log(`Settings: ${tilde(settingsPath)}`);
    console.log(`Index roots:\n${roots.map(r => '  ' + tilde(r)).join('\n')}`);
    if (missing.length) console.log(`Not found on this machine (skipped): ${missing.join(', ')}`);
    console.log(`File types: ${fileExtensions.join(', ')}`);
    console.log(`Excludes (existing + scope file): ${exclude.length} patterns\n`);

    if (!fs.existsSync(dbPath)) throw new Error(`No database at ${dbPath}`);
    if (args.apply && !args.force) {
        const pids = openers(dbPath);
        if (pids === null) throw new Error('Cannot check whether VS Code has the database open (no lsof). Close VS Code and rerun with --force.');
        if (pids.length) throw new Error(`The database is open by process(es) ${pids.join(', ')}. Quit VS Code (all windows) and rerun.`);
    }

    const db = createClient({ url: 'file:' + dbPath });
    await db.execute('PRAGMA busy_timeout = 30000');
    const rows = (await db.execute(`
        SELECT f.path,
               (SELECT count(*) FROM chunks c WHERE c.file_id = f.id) AS chunks,
               (SELECT count(*) FROM headings h WHERE h.file_id = f.id AND h.todo_state IS NOT NULL) AS todos
        FROM files f`)).rows.map(r => ({ path: String(r.path), chunks: Number(r.chunks), todos: Number(r.todos) }));

    const keep = rows.filter(f => inScope(f.path));
    const drop = rows.filter(f => !inScope(f.path));

    console.log(`Keep:   ${fmt(summarize(keep))}`);
    console.log(`Remove: ${fmt(summarize(drop))}\n`);
    console.log('Removed, by folder (top 25):');
    for (const [k, g] of groupByFolder(drop).slice(0, 25)) {
        console.log(`  ${String(g.files).padStart(6)} files ${String(g.todos).padStart(5)} TODOs  ${k}`);
    }

    const newSettings = {
        'scimax.db.include': include.map(tilde),
        'scimax.db.exclude': exclude,
        'scimax.db.fileExtensions': fileExtensions,
        'scimax.db.includeJournal': includeJournal,
        'scimax.db.includeProjects': includeProjects,
        'scimax.db.includeWorkspace': includeWorkspace,
    };

    if (!args.apply) {
        console.log('\nSettings that --apply would write:');
        console.log(JSON.stringify(newSettings, null, 2));
        console.log('\nDry run: nothing changed. Rerun with --apply (VS Code closed) to make these changes.');
        db.close();
        return;
    }

    // 1. settings.json
    const settingsBackup = `${settingsPath}.bak-${stamp()}`;
    if (fs.existsSync(settingsPath)) fs.copyFileSync(settingsPath, settingsBackup);
    if (jsonc) {
        let text = settings.text;
        for (const [key, value] of Object.entries(newSettings)) {
            const edits = jsonc.modify(text, [key], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
            text = jsonc.applyEdits(text, edits);
        }
        fs.writeFileSync(settingsPath, text);
    } else {
        // No jsonc-parser: only safe if the file is plain JSON (readSettings would have thrown otherwise).
        fs.writeFileSync(settingsPath, JSON.stringify({ ...settings.data, ...newSettings }, null, 2) + '\n');
    }
    console.log(`\nUpdated ${tilde(settingsPath)} (backup: ${tilde(settingsBackup)})`);

    // 2. database backup
    if (args.backup) {
        const backup = dbPath.replace(/\.sqlite$/, '') + `.backup-${stamp()}.sqlite`;
        console.log(`Backing up database to ${tilde(backup)} ...`);
        await db.execute({ sql: 'VACUUM INTO ?', args: [backup] });
    }

    // 3. purge, in one transaction
    if (drop.length) {
        console.log(`Removing ${drop.length.toLocaleString()} files ...`);
        const t0 = Date.now();
        const stmts = ['CREATE TEMP TABLE IF NOT EXISTS scope_drop (path TEXT PRIMARY KEY)', 'DELETE FROM scope_drop'];
        for (let i = 0; i < drop.length; i += 500) {
            const part = drop.slice(i, i + 500);
            stmts.push({ sql: `INSERT OR IGNORE INTO scope_drop (path) VALUES ${part.map(() => '(?)').join(',')}`, args: part.map(f => f.path) });
        }
        for (const table of ['headings', 'source_blocks', 'links', 'anchors', 'dependencies', 'hashtags', 'chunks']) {
            stmts.push(`DELETE FROM ${table} WHERE file_path IN (SELECT path FROM scope_drop)`);
        }
        // FTS5 can only look rows up by rowid: collect them in one scan.
        stmts.push('DELETE FROM fts_content WHERE rowid IN (SELECT rowid FROM fts_content WHERE file_path IN (SELECT path FROM scope_drop))');
        stmts.push('DELETE FROM files WHERE path IN (SELECT path FROM scope_drop)');
        stmts.push('DROP TABLE scope_drop');
        await db.batch(stmts, 'write');
        console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }

    // 4. reclaim space and shrink the WAL
    console.log('Compacting (VACUUM) ...');
    const before = fs.statSync(dbPath).size;
    await db.execute('VACUUM');
    await db.execute('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
    const after = fs.statSync(dbPath).size;
    console.log(`  ${(before / 1e9).toFixed(2)} GB -> ${(after / 1e9).toFixed(2)} GB`);
    console.log('\nDone. Start VS Code; files in scope that are new or changed are picked up by Refresh Database.');
}

main().catch(err => {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
});
