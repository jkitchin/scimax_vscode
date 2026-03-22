/**
 * Skill command - install/update/remove the scimax Claude Code skill
 *
 * Usage:
 *   scimax skill install     Install skill to ~/.claude/skills/scimax/
 *   scimax skill update      Update SKILL.md + reference.md (preserves learnings.md)
 *   scimax skill uninstall   Remove ~/.claude/skills/scimax/
 *   scimax skill show        Print skill content to stdout
 *   scimax skill path        Print installation path
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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

const SKILL_INSTALL_DIR = path.join(os.homedir(), '.claude', 'skills', 'scimax');
const SKILL_FILE = path.join(SKILL_INSTALL_DIR, 'SKILL.md');
const REFERENCE_FILE = path.join(SKILL_INSTALL_DIR, 'reference.md');
const LEARNINGS_FILE = path.join(SKILL_INSTALL_DIR, 'learnings.md');

/** Files that get overwritten on update */
const UPDATABLE_ASSETS = ['SKILL.md', 'reference.md'];

/** Files that are only created if missing (never overwritten) */
const PRESERVED_ASSETS = ['learnings.md'];

/**
 * Read a bundled asset from the package assets directory.
 * At runtime this resolves to out/cli/assets/<filename>.
 */
function readBundledAsset(filename: string): string {
    const assetPath = path.join(__dirname, '..', 'assets', filename);
    if (!fs.existsSync(assetPath)) {
        throw new Error(`Bundled asset not found at: ${assetPath}\nTry rebuilding the extension with 'make compile'.`);
    }
    return fs.readFileSync(assetPath, 'utf-8');
}

/**
 * Extract the version from a SKILL.md file.
 * Checks YAML frontmatter `version:` field first, then HTML comment fallback.
 */
function extractVersion(content: string): string | null {
    const yamlMatch = content.match(/^version:\s*["']?([\d.]+)["']?/m);
    if (yamlMatch) return yamlMatch[1];
    const commentMatch = content.match(/<!--\s*scimax-skill\s+v([\d.]+)\s*-->/);
    return commentMatch ? commentMatch[1] : null;
}

async function installSkill(force = false): Promise<void> {
    if (fs.existsSync(SKILL_FILE) && !force) {
        const existing = fs.readFileSync(SKILL_FILE, 'utf-8');
        const version = extractVersion(existing);
        const versionStr = version ? `v${version}` : 'unknown version';
        console.log(`Skill already installed (${versionStr}) at:`);
        console.log(`  ${SKILL_INSTALL_DIR}`);
        console.log();
        console.log('To update to the latest bundled version, run:');
        console.log('  scimax skill update');
        console.log();
        console.log('To customize the skill, edit the files directly.');
        return;
    }

    // Ensure target directory exists
    fs.mkdirSync(SKILL_INSTALL_DIR, { recursive: true });

    // Write updatable assets (always overwritten)
    for (const filename of UPDATABLE_ASSETS) {
        const content = readBundledAsset(filename);
        fs.writeFileSync(path.join(SKILL_INSTALL_DIR, filename), content, 'utf-8');
    }

    // Write preserved assets (only if missing)
    for (const filename of PRESERVED_ASSETS) {
        const targetPath = path.join(SKILL_INSTALL_DIR, filename);
        if (!fs.existsSync(targetPath)) {
            const content = readBundledAsset(filename);
            fs.writeFileSync(targetPath, content, 'utf-8');
        } else if (force) {
            console.log(`  Preserved ${filename} (not overwritten)`);
        }
    }

    const skillContent = readBundledAsset('SKILL.md');
    const version = extractVersion(skillContent);
    const versionStr = version ? `v${version}` : '';
    const action = force ? 'Updated' : 'Installed';

    console.log(`${action} scimax skill ${versionStr} to:`);
    console.log(`  ${SKILL_INSTALL_DIR}`);
    console.log();
    console.log('Files:');
    console.log('  SKILL.md      - Main skill instructions');
    console.log('  reference.md  - Detailed command reference');
    console.log('  learnings.md  - User corrections (preserved across updates)');
    console.log();
    console.log('In Claude Code, use /scimax to activate the skill.');
    console.log('Or just describe what you want — Claude will trigger it automatically.');
}

async function uninstallSkill(): Promise<void> {
    if (!fs.existsSync(SKILL_INSTALL_DIR)) {
        console.log('Skill not installed — nothing to remove.');
        return;
    }

    fs.rmSync(SKILL_INSTALL_DIR, { recursive: true, force: true });
    console.log(`Removed: ${SKILL_INSTALL_DIR}`);
}

function showSkill(): void {
    const content = readBundledAsset('SKILL.md');
    process.stdout.write(content);
}

function printSkillHelp(): void {
    console.log(`
scimax skill - Manage the scimax Claude Code skill

USAGE:
    scimax skill install     Install skill to ~/.claude/skills/scimax/
    scimax skill update      Update SKILL.md + reference.md (preserves learnings.md)
    scimax skill uninstall   Remove ~/.claude/skills/scimax/ directory
    scimax skill show        Print bundled SKILL.md to stdout
    scimax skill path        Print the installation path

FILES:
    SKILL.md      Main skill instructions (overwritten on update)
    reference.md  Detailed command reference (overwritten on update)
    learnings.md  User corrections and preferences (preserved on update)

ABOUT:
    The scimax skill enables Claude Code to interact with your org-mode notes,
    agenda, citations, journal, and the scimax database directly from conversations.

    After installing, Claude Code will automatically use scimax commands when
    you ask about your notes, agenda, TODOs, or org files.

    The skill improves over time: when you correct Claude's behavior, the
    correction is saved to learnings.md and applied in future conversations.

EXAMPLES:
    scimax skill install
    scimax skill update
    scimax skill show > ~/my-custom-skill.md   # Export for customization
    scimax skill path
`);
}

export async function skillCommand(_config: CliConfig, args: ParsedArgs): Promise<void> {
    const subcommand = args.subcommand || '';

    switch (subcommand) {
        case 'install':
            await installSkill(false);
            break;
        case 'update':
            await installSkill(true);
            break;
        case 'uninstall':
            await uninstallSkill();
            break;
        case 'show':
            showSkill();
            break;
        case 'path':
            console.log(SKILL_INSTALL_DIR);
            break;
        default:
            printSkillHelp();
            break;
    }
}
