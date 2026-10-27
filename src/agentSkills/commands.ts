/**
 * Agent Skill Commands
 * Install the bundled scimax skills (skills/<name>/SKILL.md) for Claude Code,
 * VS Code (GitHub Copilot), Codex, Cursor and other agents, the same way
 * `scimax skill install` and `uvx knowhow add jkitchin/scimax_vscode` do.
 */

import * as vscode from 'vscode';
import { installSkills, learningsPath, SkillScope } from '../cli/skillInstaller';

/**
 * Register agent skill commands
 */
export function registerAgentSkillCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.skills.install', async () => {
            await installAgentSkills(context);
        })
    );
}

async function installAgentSkills(context: vscode.ExtensionContext): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const items: (vscode.QuickPickItem & { scope: SkillScope })[] = [
        {
            label: 'For all projects',
            description: '~/.agents/skills and ~/.claude/skills',
            scope: 'global',
        },
    ];
    if (workspaceFolder) {
        items.push({
            label: 'For this workspace',
            description: `${workspaceFolder.name}/.agents/skills and .claude/skills`,
            scope: 'project',
        });
    }
    const choice = await vscode.window.showQuickPick(items, {
        placeHolder: 'Install the scimax agent skills (Claude Code, GitHub Copilot, Codex, ...)',
    });
    if (!choice) {
        return;
    }

    try {
        const result = installSkills({
            sourceDir: context.asAbsolutePath('skills'),
            scope: choice.scope,
            cwd: workspaceFolder?.uri.fsPath,
        });
        const skipped = result.skipped.map(s => `${s.name}: ${s.reason}`);
        if (result.installed.length > 0) {
            const moved = result.migratedLearnings ? ` Learnings from the old install moved to ${result.migratedLearnings}.` : '';
            vscode.window.showInformationMessage(
                `Installed scimax skills: ${result.installed.join(', ')} in ${result.locations.agentsDir}.${moved}`
            );
        }
        if (skipped.length > 0) {
            vscode.window.showWarningMessage(
                `Some scimax skills were not installed. ${skipped.join('; ')}. Run "scimax skill install --force" to replace them.`
            );
        }
        if (result.installed.length > 0 && choice.scope === 'global') {
            // Mention where corrections are kept, once
            const key = 'scimax.skills.learningsNoticeShown';
            if (!context.globalState.get(key)) {
                await context.globalState.update(key, true);
                vscode.window.showInformationMessage(`Corrections you give the agent are saved to ${learningsPath()} and kept across updates.`);
            }
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to install scimax skills: ${error instanceof Error ? error.message : String(error)}`);
    }
}
