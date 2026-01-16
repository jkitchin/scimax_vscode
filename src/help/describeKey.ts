/**
 * Describe Key - Emacs-style help system for discovering keybindings
 *
 * Provides commands to:
 * - C-h k: Describe what command a key sequence is bound to
 * - C-h b: Browse all keybindings
 * - C-h f: Describe a command and show its keybindings
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Keybinding information from package.json
 */
export interface KeybindingInfo {
    command: string;
    key: string;
    mac?: string;
    when?: string;
}

/**
 * Command information from package.json
 */
export interface CommandInfo {
    command: string;
    title: string;
    category?: string;
    icon?: string;
}

/**
 * Combined info for display
 */
interface KeybindingDisplayInfo {
    keybinding: KeybindingInfo;
    commandInfo: CommandInfo | undefined;
}

/**
 * HelpSystem manages keybinding and command lookups
 */
export class HelpSystem {
    private keybindings: KeybindingInfo[] = [];
    private commands: Map<string, CommandInfo> = new Map();
    private keyToBindings: Map<string, KeybindingInfo[]> = new Map();
    private commandToKeys: Map<string, KeybindingInfo[]> = new Map();
    private isMac: boolean;

    constructor(private context: vscode.ExtensionContext) {
        this.isMac = process.platform === 'darwin';
        this.loadPackageJson();
    }

    /**
     * Load keybindings and commands from package.json
     */
    private loadPackageJson(): void {
        try {
            const packagePath = path.join(this.context.extensionPath, 'package.json');
            const content = fs.readFileSync(packagePath, 'utf8');
            const pkg = JSON.parse(content);

            // Load commands
            if (pkg.contributes?.commands) {
                for (const cmd of pkg.contributes.commands) {
                    this.commands.set(cmd.command, {
                        command: cmd.command,
                        title: cmd.title,
                        category: cmd.category,
                        icon: cmd.icon,
                    });
                }
            }

            // Load keybindings
            if (pkg.contributes?.keybindings) {
                this.keybindings = pkg.contributes.keybindings;

                // Build lookup maps
                for (const kb of this.keybindings) {
                    // Key to bindings map (use platform-appropriate key)
                    const key = this.isMac && kb.mac ? kb.mac : kb.key;
                    const normalizedKey = this.normalizeKey(key);

                    const existing = this.keyToBindings.get(normalizedKey) || [];
                    existing.push(kb);
                    this.keyToBindings.set(normalizedKey, existing);

                    // Command to keys map
                    const cmdKeys = this.commandToKeys.get(kb.command) || [];
                    cmdKeys.push(kb);
                    this.commandToKeys.set(kb.command, cmdKeys);
                }
            }
        } catch (error) {
            console.error('Failed to load package.json:', error);
        }
    }

    /**
     * Normalize a key sequence for consistent lookup
     */
    private normalizeKey(key: string): string {
        return key.toLowerCase().replace(/\s+/g, ' ').trim();
    }

    /**
     * Convert Emacs-style key notation to VS Code format
     * C-c C-c -> ctrl+c ctrl+c
     * M-x -> alt+x
     * s-x -> cmd+x (Mac) or super+x
     */
    public parseEmacsNotation(input: string): string {
        let result = input.toLowerCase().trim();

        // Handle Emacs notation
        result = result
            // C- prefix for Control
            .replace(/\bc-/g, 'ctrl+')
            // M- prefix for Meta/Alt
            .replace(/\bm-/g, 'alt+')
            // s- prefix for Super (Cmd on Mac)
            .replace(/\bs-/g, this.isMac ? 'cmd+' : 'super+')
            // S- prefix for Shift
            .replace(/\bS-/gi, 'shift+')
            // Common key names
            .replace(/<return>/g, 'enter')
            .replace(/<ret>/g, 'enter')
            .replace(/<tab>/g, 'tab')
            .replace(/<escape>/g, 'escape')
            .replace(/<esc>/g, 'escape')
            .replace(/<space>/g, 'space')
            .replace(/<backspace>/g, 'backspace')
            .replace(/<delete>/g, 'delete')
            .replace(/<up>/g, 'up')
            .replace(/<down>/g, 'down')
            .replace(/<left>/g, 'left')
            .replace(/<right>/g, 'right')
            .replace(/<home>/g, 'home')
            .replace(/<end>/g, 'end')
            .replace(/<pageup>/g, 'pageup')
            .replace(/<pagedown>/g, 'pagedown')
            // Clean up spaces
            .replace(/\s+/g, ' ')
            .trim();

        return result;
    }

    /**
     * Look up keybindings for a key sequence
     */
    public lookupKey(keySequence: string): KeybindingDisplayInfo[] {
        const normalized = this.normalizeKey(this.parseEmacsNotation(keySequence));
        const bindings = this.keyToBindings.get(normalized) || [];

        return bindings.map((kb) => ({
            keybinding: kb,
            commandInfo: this.commands.get(kb.command),
        }));
    }

    /**
     * Look up keybindings for a command
     */
    public lookupCommand(commandId: string): KeybindingInfo[] {
        return this.commandToKeys.get(commandId) || [];
    }

    /**
     * Get command info
     */
    public getCommandInfo(commandId: string): CommandInfo | undefined {
        return this.commands.get(commandId);
    }

    /**
     * Get all keybindings
     */
    public getAllKeybindings(): KeybindingDisplayInfo[] {
        return this.keybindings.map((kb) => ({
            keybinding: kb,
            commandInfo: this.commands.get(kb.command),
        }));
    }

    /**
     * Get all commands
     */
    public getAllCommands(): CommandInfo[] {
        return Array.from(this.commands.values());
    }

    /**
     * Format a keybinding for display
     */
    public formatKeybinding(kb: KeybindingInfo): string {
        const key = this.isMac && kb.mac ? kb.mac : kb.key;
        return key
            .replace(/ctrl\+/g, 'C-')
            .replace(/alt\+/g, 'M-')
            .replace(/cmd\+/g, 's-')
            .replace(/shift\+/g, 'S-')
            .replace(/ /g, ' ');
    }

    /**
     * Describe Key (C-h k) - Prompt for key and show its binding
     */
    public async describeKey(): Promise<void> {
        const input = await vscode.window.showInputBox({
            prompt: 'Type a key sequence to describe',
            placeHolder: 'e.g., C-c C-c, ctrl+enter, M-x',
            title: 'Describe Key',
        });

        if (!input) {
            return;
        }

        const results = this.lookupKey(input);

        if (results.length === 0) {
            vscode.window.showInformationMessage(`No command bound to: ${input}`);
            return;
        }

        // Show results in QuickPick
        const items: vscode.QuickPickItem[] = results.map((result) => {
            const title = result.commandInfo?.title || result.keybinding.command;
            const key = this.formatKeybinding(result.keybinding);

            return {
                label: `$(key) ${key}`,
                description: title,
                detail: this.formatBindingDetail(result),
            };
        });

        // Add option to execute
        const selected = await vscode.window.showQuickPick(items, {
            title: `Key: ${input}`,
            placeHolder: 'Select to see details or press Enter to execute',
        });

        if (selected) {
            const result = results[items.indexOf(selected)];
            await this.showCommandDetails(result.keybinding.command);
        }
    }

    /**
     * List Keybindings (C-h b) - Show all keybindings
     */
    public async listKeybindings(): Promise<void> {
        const allBindings = this.getAllKeybindings();

        interface KeybindingQuickPickItem extends vscode.QuickPickItem {
            binding: KeybindingDisplayInfo;
        }

        const items: KeybindingQuickPickItem[] = allBindings.map((binding) => {
            const key = this.formatKeybinding(binding.keybinding);
            const title = binding.commandInfo?.title || binding.keybinding.command;

            return {
                label: `$(key) ${key}`,
                description: title,
                detail: binding.keybinding.when ? `When: ${binding.keybinding.when}` : undefined,
                binding,
            };
        });

        // Sort by key
        items.sort((a, b) => a.label.localeCompare(b.label));

        const selected = await vscode.window.showQuickPick(items, {
            title: 'All Keybindings',
            placeHolder: 'Filter keybindings...',
            matchOnDescription: true,
            matchOnDetail: true,
        });

        if (selected) {
            await this.showCommandDetails(selected.binding.keybinding.command);
        }
    }

    /**
     * Describe Command (C-h f) - Select a command and show its info
     */
    public async describeCommand(): Promise<void> {
        const allCommands = this.getAllCommands();

        interface CommandQuickPickItem extends vscode.QuickPickItem {
            commandInfo: CommandInfo;
        }

        const items: CommandQuickPickItem[] = allCommands.map((cmd) => {
            const keybindings = this.lookupCommand(cmd.command);
            const keyStr =
                keybindings.length > 0
                    ? keybindings.map((kb) => this.formatKeybinding(kb)).join(', ')
                    : 'No keybinding';

            return {
                label: `$(symbol-function) ${cmd.command}`,
                description: cmd.title,
                detail: keyStr,
                commandInfo: cmd,
            };
        });

        // Sort by command name
        items.sort((a, b) => a.commandInfo.command.localeCompare(b.commandInfo.command));

        const selected = await vscode.window.showQuickPick(items, {
            title: 'Describe Command',
            placeHolder: 'Search for a command...',
            matchOnDescription: true,
            matchOnDetail: true,
        });

        if (selected) {
            await this.showCommandDetails(selected.commandInfo.command);
        }
    }

    /**
     * Show detailed information about a command
     */
    private async showCommandDetails(commandId: string): Promise<void> {
        const commandInfo = this.getCommandInfo(commandId);
        const keybindings = this.lookupCommand(commandId);

        const lines: string[] = [];
        lines.push(`Command: ${commandId}`);

        if (commandInfo) {
            lines.push(`Title: ${commandInfo.title}`);
        }

        if (keybindings.length > 0) {
            lines.push('');
            lines.push('Keybindings:');
            for (const kb of keybindings) {
                const key = this.formatKeybinding(kb);
                lines.push(`  ${key}`);
                if (kb.when) {
                    lines.push(`    When: ${kb.when}`);
                }
                if (kb.mac && kb.key !== kb.mac) {
                    lines.push(`    Mac: ${kb.mac}`);
                }
            }
        } else {
            lines.push('');
            lines.push('No keybinding assigned');
        }

        const detail = lines.join('\n');

        const action = await vscode.window.showQuickPick(
            [
                { label: '$(play) Execute Command', action: 'execute' },
                { label: '$(copy) Copy Command ID', action: 'copy' },
                { label: '$(close) Close', action: 'close' },
            ],
            {
                title: commandInfo?.title || commandId,
                placeHolder: detail,
            }
        );

        if (action?.action === 'execute') {
            try {
                await vscode.commands.executeCommand(commandId);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to execute command: ${error}`);
            }
        } else if (action?.action === 'copy') {
            await vscode.env.clipboard.writeText(commandId);
            vscode.window.showInformationMessage(`Copied: ${commandId}`);
        }
    }

    /**
     * Format binding detail for display
     */
    private formatBindingDetail(result: KeybindingDisplayInfo): string {
        const parts: string[] = [];
        parts.push(`Command: ${result.keybinding.command}`);

        if (result.keybinding.when) {
            parts.push(`When: ${result.keybinding.when}`);
        }

        if (result.keybinding.mac && result.keybinding.key !== result.keybinding.mac) {
            parts.push(`Mac: ${result.keybinding.mac}`);
        }

        return parts.join(' | ');
    }
}
