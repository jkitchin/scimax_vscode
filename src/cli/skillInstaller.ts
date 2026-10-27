/**
 * Install the bundled scimax agent skills (skills/<name>/SKILL.md) the same way
 * `uvx knowhow add jkitchin/scimax_vscode` and `npx skills add` do, so all three
 * tools see the same installs:
 *
 *   - the skill is copied once to `.agents/skills/<name>` (read by VS Code /
 *     GitHub Copilot, Codex, Cursor, OpenCode, Gemini CLI, ...)
 *   - `.claude/skills/<name>` is a relative symlink to that copy (Claude Code)
 *   - the install is recorded in the npx-skills lock file:
 *       global:  ~/.agents/.skill-lock.json (v3, or $XDG_STATE_HOME/skills/.skill-lock.json)
 *       project: ./skills-lock.json (v1)
 *
 * Global installs go under the home directory, project installs under `cwd`.
 * Used by both the `scimax skill` CLI command and the VS Code command.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Lock-file source for skills from this repository (the GitHub shorthand npx/knowhow write) */
export const SKILL_SOURCE = 'jkitchin/scimax_vscode';
const SOURCE_URL = 'https://github.com/jkitchin/scimax_vscode.git';

const GLOBAL_LOCK_VERSION = 3;
const PROJECT_LOCK_VERSION = 1;

/** Files never copied on install (matches knowhow / npx skills) */
const EXCLUDED_FILES = new Set(['.git', '__pycache__', '__pypackages__', '.DS_Store', 'metadata.json', 'node_modules']);

/** Name of the skill installed by `scimax skill install` before 0.14.0 */
const LEGACY_SKILL = 'scimax';

export type SkillScope = 'global' | 'project';

export interface SkillInstallOptions {
    /** Directory containing the bundled skills (<sourceDir>/<name>/SKILL.md) */
    sourceDir: string;
    scope: SkillScope;
    /** Project directory for scope 'project' (default: process.cwd()) */
    cwd?: string;
    /** Home directory for scope 'global' (default: os.homedir()) */
    home?: string;
    /** Environment, for XDG variables (default: process.env) */
    env?: NodeJS.ProcessEnv;
    /** Skill names to install/remove (default: every bundled skill) */
    skills?: string[];
    /** Replace skill folders that were not installed from this repository */
    force?: boolean;
}

export interface SkillLocations {
    /** Canonical copies: <base>/.agents/skills */
    agentsDir: string;
    /** Claude Code links: <base>/.claude/skills */
    claudeDir: string;
    lockFile: string;
    lockVersion: number;
}

export interface SkillInstallResult {
    installed: string[];
    /** Skills not installed, with the reason */
    skipped: { name: string; reason: string }[];
    /** Set when learnings from a pre-0.14 install were moved to the shared learnings file */
    migratedLearnings?: string;
    locations: SkillLocations;
}

interface LockFile {
    version?: number;
    skills: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
}

export function skillLocations(opts: Pick<SkillInstallOptions, 'scope' | 'cwd' | 'home' | 'env'>): SkillLocations {
    const env = opts.env ?? process.env;
    if (opts.scope === 'project') {
        const base = opts.cwd ?? process.cwd();
        return {
            agentsDir: path.join(base, '.agents', 'skills'),
            claudeDir: path.join(base, '.claude', 'skills'),
            lockFile: path.join(base, 'skills-lock.json'),
            lockVersion: PROJECT_LOCK_VERSION,
        };
    }
    const home = opts.home ?? os.homedir();
    const lockFile = env.XDG_STATE_HOME
        ? path.join(env.XDG_STATE_HOME, 'skills', '.skill-lock.json')
        : path.join(home, '.agents', '.skill-lock.json');
    return {
        agentsDir: path.join(home, '.agents', 'skills'),
        claudeDir: path.join(home, '.claude', 'skills'),
        lockFile,
        lockVersion: GLOBAL_LOCK_VERSION,
    };
}

/** Shared learnings file that all scimax skills read and append to */
export function learningsPath(home: string = os.homedir(), env: NodeJS.ProcessEnv = process.env): string {
    const configHome = env.XDG_CONFIG_HOME || path.join(home, '.config');
    return path.join(configHome, 'scimax', 'learnings.md');
}

/** Names of the skills in sourceDir (directories containing SKILL.md) */
export function listBundledSkills(sourceDir: string): string[] {
    if (!fs.existsSync(sourceDir)) {
        throw new Error(`Bundled skills not found at: ${sourceDir}`);
    }
    return fs.readdirSync(sourceDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && fs.existsSync(path.join(sourceDir, d.name, 'SKILL.md')))
        .map(d => d.name)
        .sort();
}

/** Value of `metadata.version` in a SKILL.md, if any */
export function skillVersion(skillMd: string): string | null {
    const match = skillMd.match(/^metadata:\s*\n(?:[ \t]+.*\n)*?[ \t]+version:\s*["']?([\w.-]+)["']?/m);
    return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Hashes, so `knowhow check` / `npx skills update` see an up-to-date install
// ---------------------------------------------------------------------------

function listFiles(dir: string, rel = ''): string[] {
    const files: string[] = [];
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
        if (EXCLUDED_FILES.has(entry.name)) continue;
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            files.push(...listFiles(dir, relPath));
        } else if (entry.isFile()) {
            files.push(relPath);
        }
    }
    return files;
}

/**
 * SHA-256 over relative paths and contents in localeCompare order: the
 * `computedHash` npx skills and knowhow store in project lock files.
 */
export function folderHash(dir: string): string {
    const hash = crypto.createHash('sha256');
    for (const rel of listFiles(dir).sort((a, b) => a.localeCompare(b))) {
        hash.update(rel, 'utf-8');
        hash.update(fs.readFileSync(path.join(dir, rel)));
    }
    return hash.digest('hex');
}

/**
 * Git tree SHA-1 of a directory (what `git rev-parse HEAD:<dir>` prints): the
 * `skillFolderHash` npx skills and knowhow store in the global lock file.
 */
export function gitTreeHash(dir: string): string {
    const entries: { name: string; sortKey: string; mode: string; sha: Buffer }[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (listFiles(full).length === 0) continue; // git does not track empty directories
            entries.push({ name: entry.name, sortKey: entry.name + '/', mode: '40000', sha: Buffer.from(gitTreeHash(full), 'hex') });
        } else if (entry.isFile()) {
            const content = fs.readFileSync(full);
            const blob = crypto.createHash('sha1')
                .update(`blob ${content.length}\0`)
                .update(content)
                .digest();
            const mode = (fs.statSync(full).mode & 0o111) ? '100755' : '100644';
            entries.push({ name: entry.name, sortKey: entry.name, mode, sha: blob });
        }
    }
    entries.sort((a, b) => Buffer.compare(Buffer.from(a.sortKey), Buffer.from(b.sortKey)));
    const body = Buffer.concat(entries.map(e => Buffer.concat([Buffer.from(`${e.mode} ${e.name}\0`), e.sha])));
    return crypto.createHash('sha1')
        .update(`tree ${body.length}\0`)
        .update(body)
        .digest('hex');
}

// ---------------------------------------------------------------------------
// Lock file
// ---------------------------------------------------------------------------

/** Read a lock file, keeping keys we don't manage. Throws if it exists but is damaged. */
function readLock(locations: SkillLocations): LockFile {
    if (!fs.existsSync(locations.lockFile)) {
        return { version: locations.lockVersion, skills: {} };
    }
    const text = fs.readFileSync(locations.lockFile, 'utf-8');
    let data: unknown;
    try {
        data = text.trim() ? JSON.parse(text) : {};
    } catch {
        throw new Error(`${locations.lockFile} is not valid JSON; fix or move it aside`);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error(`${locations.lockFile} is not a JSON object; fix or move it aside`);
    }
    const lock = data as LockFile;
    if (lock.skills === undefined) lock.skills = {};
    if (typeof lock.skills !== 'object' || Array.isArray(lock.skills)) {
        throw new Error(`${locations.lockFile}: 'skills' is not an object; fix or move it aside`);
    }
    if (lock.version === undefined) lock.version = locations.lockVersion;
    return lock;
}

function writeLock(locations: SkillLocations, lock: LockFile): void {
    if (locations.lockVersion === PROJECT_LOCK_VERSION) {
        lock.skills = Object.fromEntries(Object.entries(lock.skills).sort(([a], [b]) => a.localeCompare(b)));
    }
    fs.mkdirSync(path.dirname(locations.lockFile), { recursive: true });
    const tmp = `${locations.lockFile}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(lock, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmp, locations.lockFile);
}

function isOurs(entry: Record<string, unknown> | undefined): boolean {
    return !!entry && typeof entry.source === 'string' && entry.source.toLowerCase() === SKILL_SOURCE;
}

// ---------------------------------------------------------------------------
// Install / uninstall
// ---------------------------------------------------------------------------

function exists(p: string): boolean {
    try {
        fs.lstatSync(p);
        return true;
    } catch {
        return false;
    }
}

/** True if a and b are the same directory once symlinks are resolved */
function sameLocation(a: string, b: string): boolean {
    try {
        return fs.realpathSync(a) === fs.realpathSync(b);
    } catch {
        return false;
    }
}

function copyDir(src: string, dst: string): void {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        if (EXCLUDED_FILES.has(entry.name)) continue;
        const from = path.join(src, entry.name);
        const to = path.join(dst, entry.name);
        if (entry.isDirectory()) {
            copyDir(from, to);
        } else if (entry.isFile()) {
            fs.copyFileSync(from, to);
            fs.chmodSync(to, fs.statSync(from).mode);
        }
    }
}

/** A pre-0.14 `scimax skill install`: a real ~/.claude/skills/scimax folder with the old version marker */
function isLegacyInstall(dir: string): boolean {
    try {
        if (fs.lstatSync(dir).isSymbolicLink()) return false;
        const skillMd = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8');
        return /<!--\s*scimax-skill\s+v[\d.]+\s*-->/.test(skillMd);
    } catch {
        return false;
    }
}

/**
 * Move entries from a legacy skill folder's learnings.md into the shared
 * learnings file. Returns the destination if anything was moved.
 */
function migrateLearnings(legacyDir: string, home: string, env: NodeJS.ProcessEnv): string | undefined {
    const legacyFile = path.join(legacyDir, 'learnings.md');
    if (!fs.existsSync(legacyFile)) return undefined;
    const text = fs.readFileSync(legacyFile, 'utf-8');
    const firstEntry = text.search(/^## /m);
    if (firstEntry < 0) return undefined; // only the template, no entries
    const entries = text.slice(firstEntry).trimEnd() + '\n';
    const dest = learningsPath(home, env);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) {
        const existing = fs.readFileSync(dest, 'utf-8');
        if (!existing.includes(entries.trim())) {
            fs.appendFileSync(dest, (existing.endsWith('\n') ? '\n' : '\n\n') + entries, 'utf-8');
        }
    } else {
        fs.writeFileSync(dest, `# Scimax Learnings\n\nUser corrections shared by all scimax skills.\n\n${entries}`, 'utf-8');
    }
    return dest;
}

export function installSkills(opts: SkillInstallOptions): SkillInstallResult {
    const env = opts.env ?? process.env;
    const home = opts.home ?? os.homedir();
    const locations = skillLocations(opts);
    const bundled = listBundledSkills(opts.sourceDir);
    const names = opts.skills?.length ? opts.skills : bundled;
    const lock = readLock(locations);
    const result: SkillInstallResult = { installed: [], skipped: [], locations };

    for (const name of names) {
        if (!bundled.includes(name)) {
            result.skipped.push({ name, reason: `no bundled skill named '${name}' (available: ${bundled.join(', ')})` });
            continue;
        }
        const source = path.join(opts.sourceDir, name);
        const canonical = path.join(locations.agentsDir, name);
        const link = path.join(locations.claudeDir, name);
        const owned = isOurs(lock.skills[name]);
        const legacy = name === LEGACY_SKILL && isLegacyInstall(link);
        const linkIsOurs = !exists(link) || sameLocation(link, canonical)
            || fs.lstatSync(link).isSymbolicLink() || legacy || owned;

        if (!opts.force && ((exists(canonical) && !owned) || !linkIsOurs)) {
            const where = exists(canonical) && !owned ? canonical : link;
            result.skipped.push({ name, reason: `${where} exists and was not installed from ${SKILL_SOURCE} (use --force to replace it)` });
            continue;
        }

        if (legacy) {
            result.migratedLearnings = migrateLearnings(link, home, env) ?? result.migratedLearnings;
        }

        // Canonical copy
        fs.rmSync(canonical, { recursive: true, force: true });
        copyDir(source, canonical);

        // Claude Code link (skip when .claude/skills is itself a link to .agents/skills)
        if (!sameLocation(link, canonical)) {
            fs.rmSync(link, { recursive: true, force: true });
            fs.mkdirSync(locations.claudeDir, { recursive: true });
            try {
                if (process.platform === 'win32') {
                    fs.symlinkSync(canonical, link, 'junction'); // needs no admin rights
                } else {
                    fs.symlinkSync(path.relative(locations.claudeDir, canonical), link, 'dir');
                }
            } catch {
                copyDir(source, link); // e.g. Windows without symlink permission
            }
        }

        const previous = lock.skills[name] ?? {};
        if (locations.lockVersion === GLOBAL_LOCK_VERSION) {
            const now = new Date().toISOString();
            lock.skills[name] = {
                ...previous,
                source: SKILL_SOURCE,
                sourceType: 'github',
                sourceUrl: SOURCE_URL,
                skillPath: `skills/${name}/SKILL.md`,
                skillFolderHash: gitTreeHash(canonical),
                installedAt: owned && previous.installedAt ? previous.installedAt : now,
                updatedAt: now,
            };
        } else {
            lock.skills[name] = {
                ...previous,
                source: SKILL_SOURCE,
                sourceType: 'github',
                skillPath: `skills/${name}/SKILL.md`,
                computedHash: folderHash(canonical),
            };
        }
        result.installed.push(name);
    }

    if (result.installed.length > 0) {
        writeLock(locations, lock);
    }
    return result;
}

/**
 * Remove skills installed from this repository (and a pre-0.14 install).
 * Never touches the shared learnings file. Returns the removed names.
 */
export function uninstallSkills(opts: Omit<SkillInstallOptions, 'sourceDir' | 'force'>): string[] {
    const locations = skillLocations(opts);
    const lock = readLock(locations);
    const names = opts.skills?.length
        ? opts.skills
        : Object.keys(lock.skills).filter(name => isOurs(lock.skills[name]));
    const removed: string[] = [];
    let lockChanged = false;

    for (const name of names) {
        const canonical = path.join(locations.agentsDir, name);
        const link = path.join(locations.claudeDir, name);
        if (isOurs(lock.skills[name])) {
            if (exists(link) && (fs.lstatSync(link).isSymbolicLink() || !sameLocation(link, canonical))) {
                fs.rmSync(link, { recursive: true, force: true });
            }
            fs.rmSync(canonical, { recursive: true, force: true });
            delete lock.skills[name];
            lockChanged = true;
            removed.push(name);
        } else if (name === LEGACY_SKILL && isLegacyInstall(link)) {
            fs.rmSync(link, { recursive: true, force: true });
            removed.push(name);
        }
    }
    // A legacy install left behind when nothing else matched
    if (!opts.skills?.length && !removed.includes(LEGACY_SKILL)) {
        const legacyLink = path.join(locations.claudeDir, LEGACY_SKILL);
        if (isLegacyInstall(legacyLink)) {
            fs.rmSync(legacyLink, { recursive: true, force: true });
            removed.push(LEGACY_SKILL);
        }
    }

    if (lockChanged) {
        writeLock(locations, lock);
    }
    return removed;
}

export interface SkillStatus {
    name: string;
    installed: boolean;
    /** Installed from this repository (per the lock file) */
    ours: boolean;
    /** Installed copy differs from the bundled one */
    outdated: boolean;
}

export function skillStatus(opts: Pick<SkillInstallOptions, 'sourceDir' | 'scope' | 'cwd' | 'home' | 'env'>): SkillStatus[] {
    const locations = skillLocations(opts);
    const lock = readLock(locations);
    return listBundledSkills(opts.sourceDir).map(name => {
        const canonical = path.join(locations.agentsDir, name);
        const installed = fs.existsSync(path.join(canonical, 'SKILL.md'));
        return {
            name,
            installed,
            ours: isOurs(lock.skills[name]),
            outdated: installed && folderHash(canonical) !== folderHash(path.join(opts.sourceDir, name)),
        };
    });
}
