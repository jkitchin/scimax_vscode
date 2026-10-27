/**
 * Skill command - install/update/remove the scimax agent skills
 *
 * The skills live in skills/<name>/SKILL.md at the package root, in the Agent
 * Skills layout used by knowhow and npx skills. Installs match theirs:
 * ~/.agents/skills/<name> plus a ~/.claude/skills/<name> symlink, recorded in
 * ~/.agents/.skill-lock.json (or ./.agents, ./.claude and ./skills-lock.json
 * with --project).
 *
 * Usage:
 *   scimax skill install [name...]    Install skills (all by default)
 *   scimax skill update [name...]     Reinstall the bundled version
 *   scimax skill uninstall [name...]  Remove skills installed from scimax
 *   scimax skill list                 Show bundled skills and install status
 *   scimax skill show [name]          Print a bundled SKILL.md to stdout
 *   scimax skill path                 Print installation path
 */

import * as fs from 'fs';
import * as path from 'path';

import {
    SKILL_SOURCE,
    SkillScope,
    installSkills,
    learningsPath,
    listBundledSkills,
    skillLocations,
    skillStatus,
    skillVersion,
    uninstallSkills,
} from '../skillInstaller';

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
 * Bundled skills directory. At runtime this file is out/cli/commands/skill.js,
 * so the package root is three levels up.
 */
function bundledSkillsDir(): string {
    return path.join(__dirname, '..', '..', '..', 'skills');
}

function printInstallResult(result: ReturnType<typeof installSkills>, action: string): void {
    const sourceDir = bundledSkillsDir();
    if (result.installed.length > 0) {
        console.log(`${action} scimax skills:`);
        for (const name of result.installed) {
            const skillMd = fs.readFileSync(path.join(sourceDir, name, 'SKILL.md'), 'utf-8');
            const version = skillVersion(skillMd);
            console.log(`  ${name}${version ? ` v${version}` : ''}`);
        }
        console.log();
        console.log(`  ${result.locations.agentsDir}   (VS Code/Copilot, Codex, Cursor, OpenCode, ...)`);
        console.log(`  ${result.locations.claudeDir}   (Claude Code, symlinks)`);
        console.log(`  ${result.locations.lockFile}`);
    }
    for (const { name, reason } of result.skipped) {
        console.log(`Skipped ${name}: ${reason}`);
    }
    if (result.migratedLearnings) {
        console.log();
        console.log(`Moved your learnings from the old install to ${result.migratedLearnings}`);
    }
    if (result.installed.length > 0) {
        console.log();
        console.log(`Learnings are kept in ${learningsPath()} and survive updates.`);
        console.log('In Claude Code, use /scimax to activate the skill,');
        console.log('or just describe what you want — the agent will pick the right skill.');
    }
    if (result.skipped.length > 0) {
        process.exitCode = 1;
    }
}

function listSkills(scope: SkillScope): void {
    const status = skillStatus({ sourceDir: bundledSkillsDir(), scope });
    for (const s of status) {
        const state = !s.installed ? 'not installed'
            : !s.ours ? 'installed (not from scimax)'
            : s.outdated ? 'installed (differs from bundled; run scimax skill update)'
            : 'installed';
        console.log(`  ${s.name.padEnd(24)} ${state}`);
    }
    console.log();
    console.log(`Location: ${skillLocations({ scope }).agentsDir}`);
}

function showSkill(name: string): void {
    const file = path.join(bundledSkillsDir(), name, 'SKILL.md');
    if (!fs.existsSync(file)) {
        throw new Error(`No bundled skill named '${name}'. Available: ${listBundledSkills(bundledSkillsDir()).join(', ')}`);
    }
    process.stdout.write(fs.readFileSync(file, 'utf-8'));
}

function printSkillHelp(): void {
    console.log(`
scimax skill - Manage the scimax agent skills

USAGE:
    scimax skill install [name...]    Install skills (default: all)
    scimax skill update [name...]     Reinstall the bundled version over an install
    scimax skill uninstall [name...]  Remove skills installed from scimax
    scimax skill list                 Show bundled skills and whether they are installed
    scimax skill show [name]          Print a bundled SKILL.md (default: scimax)
    scimax skill path                 Print the installation directory

OPTIONS:
    --project    Install into the current directory (.agents/skills, .claude/skills,
                 skills-lock.json) instead of your home directory
    --force      Replace skill folders that were not installed from scimax

SKILLS:
    scimax                 Notes, agenda, TODOs, journal, export, citations, database
    scimax-org             Org-mode syntax and citation reference
    scimax-projects        Task dependencies, scimax task, Gantt charts, assignees
    scimax-presentations   Beamer and Marp slide decks

ABOUT:
    Each skill is copied to ~/.agents/skills/<name>, which VS Code (GitHub Copilot),
    Codex, Cursor, OpenCode and Gemini CLI read, and linked from ~/.claude/skills/<name>
    for Claude Code. Installs are recorded in ~/.agents/.skill-lock.json, so knowhow
    and npx skills can check and upgrade them. The same skills install from GitHub with:

        uvx knowhow add ${SKILL_SOURCE} -g -y
        npx skills add ${SKILL_SOURCE} -g -y

    When you correct the agent, the correction is saved to ~/.config/scimax/learnings.md
    and applied in future conversations. Updates never touch that file.

EXAMPLES:
    scimax skill install
    scimax skill install scimax-org --project
    scimax skill update
    scimax skill show scimax-projects
`);
}

export async function skillCommand(_config: CliConfig, args: ParsedArgs): Promise<void> {
    const subcommand = args.subcommand || '';
    const names = args.args.slice(1);
    // `--project NAME` parses NAME as the flag's value; treat it as a skill name
    for (const flag of ['project', 'force']) {
        if (typeof args.flags[flag] === 'string') names.push(args.flags[flag] as string);
    }
    const scope: SkillScope = args.flags.project ? 'project' : 'global';
    const sourceDir = bundledSkillsDir();

    switch (subcommand) {
        case 'install':
        case 'update': {
            const result = installSkills({
                sourceDir,
                scope,
                skills: names,
                // update replaces our own installs; --force also replaces foreign ones
                force: !!args.flags.force,
            });
            printInstallResult(result, subcommand === 'update' ? 'Updated' : 'Installed');
            break;
        }
        case 'uninstall': {
            const removed = uninstallSkills({ scope, skills: names });
            if (removed.length === 0) {
                console.log('No scimax skills installed — nothing to remove.');
            } else {
                console.log(`Removed: ${removed.join(', ')}`);
                console.log(`Your learnings in ${learningsPath()} were kept.`);
            }
            break;
        }
        case 'list':
            listSkills(scope);
            break;
        case 'show':
            showSkill(names[0] || 'scimax');
            break;
        case 'path':
            console.log(skillLocations({ scope }).agentsDir);
            break;
        default:
            printSkillHelp();
            break;
    }
}
