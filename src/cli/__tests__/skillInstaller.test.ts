/**
 * Tests for the agent skill installer and the bundled skills/ folder.
 *
 * Installs must match what knowhow / npx skills produce, and the skills must
 * pass the Agent Skills spec checks knowhow validates.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

import {
    SKILL_SOURCE,
    folderHash,
    gitTreeHash,
    installSkills,
    learningsPath,
    listBundledSkills,
    skillStatus,
    skillVersion,
    uninstallSkills,
} from '../skillInstaller';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SKILLS_DIR = path.join(REPO_ROOT, 'skills');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readJson(file: string): any {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function frontmatter(skillMd: string): Record<string, unknown> {
    const match = skillMd.match(/^---\n([\s\S]*?)\n---\n/);
    if (!match) throw new Error('no frontmatter');
    return yaml.load(match[1]) as Record<string, unknown>;
}

describe('bundled skills', () => {
    const names = listBundledSkills(SKILLS_DIR);

    it('ships the four scimax skills', () => {
        expect(names).toEqual(['scimax', 'scimax-org', 'scimax-presentations', 'scimax-projects']);
    });

    it.each(names)('%s follows the Agent Skills spec', (name) => {
        const skillMd = fs.readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf-8');
        const fm = frontmatter(skillMd);

        expect(fm.name).toBe(name);
        expect(fm.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(typeof fm.description).toBe('string');
        expect((fm.description as string).length).toBeLessThanOrEqual(1024);
        expect(fm.description).toMatch(/\bUse when\b/);
        expect(typeof fm['allowed-tools']).toBe('string');

        const allowed = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
        expect(Object.keys(fm).filter(k => !allowed.has(k))).toEqual([]);
        for (const value of Object.values(fm.metadata as Record<string, unknown>)) {
            expect(typeof value).toBe('string');
        }
        expect(skillVersion(skillMd)).toMatch(/^\d+\.\d+\.\d+$/);

        // Body under ~5000 tokens, no hardcoded install paths
        expect(skillMd.length / 4).toBeLessThan(5000);
        expect(skillMd).not.toContain('~/.claude/skills');
    });

    it.each(names)('%s has only relative links that resolve inside the skill', (name) => {
        const dir = path.join(SKILLS_DIR, name);
        const skillMd = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8');
        for (const [, target] of skillMd.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
            if (/^[a-z]+:/i.test(target)) continue; // URLs
            const resolved = path.resolve(dir, target);
            expect(resolved.startsWith(dir + path.sep)).toBe(true);
            expect(fs.existsSync(resolved)).toBe(true);
        }
    });

    it('has no SKILL.md that would hide the skills/ collection', () => {
        expect(fs.existsSync(path.join(REPO_ROOT, 'SKILL.md'))).toBe(false);
    });
});

describe('hashes', () => {
    it('gitTreeHash matches git for a committed, unchanged skill folder', () => {
        let expected: string;
        try {
            const status = execFileSync('git', ['status', '--porcelain', '--', 'skills/scimax'], { cwd: REPO_ROOT, encoding: 'utf-8' });
            if (status.trim()) return; // uncommitted changes: git's tree is stale
            expected = execFileSync('git', ['rev-parse', 'HEAD:skills/scimax'], { cwd: REPO_ROOT, encoding: 'utf-8' }).trim();
        } catch {
            return; // not a git checkout, or skills/ not committed yet
        }
        expect(gitTreeHash(path.join(SKILLS_DIR, 'scimax'))).toBe(expected);
    });

    it('gitTreeHash matches git hash-object for a known tree', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-tree-'));
        try {
            fs.mkdirSync(path.join(dir, 'references'));
            fs.writeFileSync(path.join(dir, 'SKILL.md'), 'hello\n');
            fs.writeFileSync(path.join(dir, 'references', 'a.md'), 'a\n');
            // Independently computed with: git init; git add .; git write-tree
            expect(gitTreeHash(dir)).toBe('07dee12627531718c0c5106912cb961b547a2ce5');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('folderHash is order-stable and content-sensitive', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-hash-'));
        try {
            fs.writeFileSync(path.join(dir, 'SKILL.md'), 'x');
            const first = folderHash(dir);
            expect(folderHash(dir)).toBe(first);
            fs.writeFileSync(path.join(dir, 'SKILL.md'), 'y');
            expect(folderHash(dir)).not.toBe(first);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('installSkills', () => {
    let home: string;
    const env: NodeJS.ProcessEnv = {};

    beforeEach(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-skill-home-'));
    });

    afterEach(() => {
        fs.rmSync(home, { recursive: true, force: true });
    });

    const global = () => ({ sourceDir: SKILLS_DIR, scope: 'global' as const, home, env });

    it('copies to ~/.agents/skills, links ~/.claude/skills and writes a v3 lock', () => {
        const result = installSkills(global());
        expect(result.installed).toEqual(listBundledSkills(SKILLS_DIR));
        expect(result.skipped).toEqual([]);

        for (const name of result.installed) {
            const canonical = path.join(home, '.agents', 'skills', name);
            const link = path.join(home, '.claude', 'skills', name);
            expect(fs.existsSync(path.join(canonical, 'SKILL.md'))).toBe(true);
            expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
            expect(fs.realpathSync(link)).toBe(fs.realpathSync(canonical));
            if (process.platform !== 'win32') {
                expect(fs.readlinkSync(link)).toBe(path.join('..', '..', '.agents', 'skills', name));
            }
        }

        const lock = readJson(path.join(home, '.agents', '.skill-lock.json'));
        expect(lock.version).toBe(3);
        expect(lock.skills['scimax-org']).toMatchObject({
            source: SKILL_SOURCE,
            sourceType: 'github',
            skillPath: 'skills/scimax-org/SKILL.md',
            skillFolderHash: gitTreeHash(path.join(SKILLS_DIR, 'scimax-org')),
        });
    });

    it('installs only the named skills', () => {
        const result = installSkills({ ...global(), skills: ['scimax-org', 'nope'] });
        expect(result.installed).toEqual(['scimax-org']);
        expect(result.skipped.map(s => s.name)).toEqual(['nope']);
        expect(fs.existsSync(path.join(home, '.agents', 'skills', 'scimax'))).toBe(false);
    });

    it('is idempotent and keeps installedAt and unknown lock keys', () => {
        installSkills(global());
        const lockFile = path.join(home, '.agents', '.skill-lock.json');
        const lock = readJson(lockFile);
        lock.dismissed = { other: true };
        lock.skills.other = { source: 'someone/else' };
        const installedAt = lock.skills.scimax.installedAt;
        fs.writeFileSync(lockFile, JSON.stringify(lock));

        const again = installSkills(global());
        expect(again.skipped).toEqual([]);
        const updated = readJson(lockFile);
        expect(updated.dismissed).toEqual({ other: true });
        expect(updated.skills.other).toEqual({ source: 'someone/else' });
        expect(updated.skills.scimax.installedAt).toBe(installedAt);
    });

    it('refuses to replace a folder it did not install unless forced', () => {
        const foreign = path.join(home, '.agents', 'skills', 'scimax-org');
        fs.mkdirSync(foreign, { recursive: true });
        fs.writeFileSync(path.join(foreign, 'SKILL.md'), 'mine');

        const result = installSkills({ ...global(), skills: ['scimax-org'] });
        expect(result.installed).toEqual([]);
        expect(result.skipped[0].reason).toContain('--force');
        expect(fs.readFileSync(path.join(foreign, 'SKILL.md'), 'utf-8')).toBe('mine');

        const forced = installSkills({ ...global(), skills: ['scimax-org'], force: true });
        expect(forced.installed).toEqual(['scimax-org']);
    });

    it('refuses to replace a real ~/.claude/skills folder it did not install', () => {
        const foreign = path.join(home, '.claude', 'skills', 'scimax-projects');
        fs.mkdirSync(foreign, { recursive: true });
        fs.writeFileSync(path.join(foreign, 'SKILL.md'), 'mine');
        const result = installSkills({ ...global(), skills: ['scimax-projects'] });
        expect(result.installed).toEqual([]);
    });

    it('replaces a pre-0.14 install and moves its learnings', () => {
        const legacy = path.join(home, '.claude', 'skills', 'scimax');
        fs.mkdirSync(legacy, { recursive: true });
        fs.writeFileSync(path.join(legacy, 'SKILL.md'), '---\nname: scimax\n---\n<!-- scimax-skill v0.13.0 -->\n');
        fs.writeFileSync(path.join(legacy, 'learnings.md'), '# Scimax Skill Learnings\n\n---\n\n## 2026-01-02: Use --local\nAlways.\n');

        const result = installSkills(global());
        expect(result.installed).toContain('scimax');
        const dest = learningsPath(home, env);
        expect(result.migratedLearnings).toBe(dest);
        expect(fs.readFileSync(dest, 'utf-8')).toContain('## 2026-01-02: Use --local');
        expect(fs.lstatSync(legacy).isSymbolicLink()).toBe(true);

        // Running it again does not duplicate entries
        installSkills(global());
        const text = fs.readFileSync(dest, 'utf-8');
        expect(text.match(/Use --local/g)).toHaveLength(1);
    });

    it('stops on a damaged lock file instead of replacing it', () => {
        const lockFile = path.join(home, '.agents', '.skill-lock.json');
        fs.mkdirSync(path.dirname(lockFile), { recursive: true });
        fs.writeFileSync(lockFile, '{ broken');
        expect(() => installSkills(global())).toThrow(/not valid JSON/);
        expect(fs.readFileSync(lockFile, 'utf-8')).toBe('{ broken');
    });

    it('honors XDG_STATE_HOME for the global lock and XDG_CONFIG_HOME for learnings', () => {
        const xdg = { XDG_STATE_HOME: path.join(home, 'state'), XDG_CONFIG_HOME: path.join(home, 'cfg') };
        installSkills({ ...global(), env: xdg, skills: ['scimax'] });
        expect(fs.existsSync(path.join(home, 'state', 'skills', '.skill-lock.json'))).toBe(true);
        expect(learningsPath(home, xdg)).toBe(path.join(home, 'cfg', 'scimax', 'learnings.md'));
    });

    it('project scope writes .agents, .claude and a v1 skills-lock.json', () => {
        const result = installSkills({ sourceDir: SKILLS_DIR, scope: 'project', cwd: home, skills: ['scimax-org'] });
        expect(result.installed).toEqual(['scimax-org']);
        const lock = readJson(path.join(home, 'skills-lock.json'));
        expect(lock.version).toBe(1);
        expect(lock.skills['scimax-org']).toMatchObject({
            source: SKILL_SOURCE,
            computedHash: folderHash(path.join(SKILLS_DIR, 'scimax-org')),
        });
        expect(fs.lstatSync(path.join(home, '.claude', 'skills', 'scimax-org')).isSymbolicLink()).toBe(true);
    });

    it('reports status and detects a modified install', () => {
        installSkills({ ...global(), skills: ['scimax'] });
        let status = skillStatus(global());
        expect(status.find(s => s.name === 'scimax')).toMatchObject({ installed: true, ours: true, outdated: false });
        expect(status.find(s => s.name === 'scimax-org')).toMatchObject({ installed: false });

        fs.appendFileSync(path.join(home, '.agents', 'skills', 'scimax', 'SKILL.md'), '\nedited\n');
        status = skillStatus(global());
        expect(status.find(s => s.name === 'scimax')?.outdated).toBe(true);
    });
});

describe('uninstallSkills', () => {
    let home: string;
    const env: NodeJS.ProcessEnv = {};

    beforeEach(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-skill-home-'));
    });

    afterEach(() => {
        fs.rmSync(home, { recursive: true, force: true });
    });

    it('removes only skills installed from scimax and keeps learnings', () => {
        installSkills({ sourceDir: SKILLS_DIR, scope: 'global', home, env });
        const other = path.join(home, '.agents', 'skills', 'other');
        fs.mkdirSync(other, { recursive: true });
        const lockFile = path.join(home, '.agents', '.skill-lock.json');
        const lock = readJson(lockFile);
        lock.skills.other = { source: 'someone/else' };
        fs.writeFileSync(lockFile, JSON.stringify(lock));
        const learnings = learningsPath(home, env);
        fs.mkdirSync(path.dirname(learnings), { recursive: true });
        fs.writeFileSync(learnings, 'keep me');

        const removed = uninstallSkills({ scope: 'global', home, env });
        expect(removed.sort()).toEqual(listBundledSkills(SKILLS_DIR));
        expect(fs.existsSync(path.join(home, '.agents', 'skills', 'scimax'))).toBe(false);
        expect(fs.existsSync(path.join(home, '.claude', 'skills', 'scimax'))).toBe(false);
        expect(fs.existsSync(other)).toBe(true);
        expect(Object.keys(readJson(lockFile).skills)).toEqual(['other']);
        expect(fs.readFileSync(learnings, 'utf-8')).toBe('keep me');
    });

    it('removes a pre-0.14 install', () => {
        const legacy = path.join(home, '.claude', 'skills', 'scimax');
        fs.mkdirSync(legacy, { recursive: true });
        fs.writeFileSync(path.join(legacy, 'SKILL.md'), '<!-- scimax-skill v0.13.0 -->\n');
        expect(uninstallSkills({ scope: 'global', home, env })).toEqual(['scimax']);
        expect(fs.existsSync(legacy)).toBe(false);
        expect(fs.existsSync(path.join(home, '.agents', '.skill-lock.json'))).toBe(false);
    });
});
