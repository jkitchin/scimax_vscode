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
 * Documentation index entry (from pre-built index)
 */
interface DocEntry {
    heading: string;
    level: number;
    file: string;
    line: number;
    content: string;
    path: string[];
    commands: string[];
    keybindings: string[];
    keywords: string[];
}

/**
 * Pre-built documentation index
 */
interface DocIndex {
    buildDate: string;
    count: number;
    entries: DocEntry[];
}

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
 * Setting/variable information from package.json
 */
export interface SettingInfo {
    name: string;
    type: string;
    default?: unknown;
    description?: string;
    markdownDescription?: string;
    enum?: string[];
    minimum?: number;
    maximum?: number;
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
    private settings: Map<string, SettingInfo> = new Map();
    private keyToBindings: Map<string, KeybindingInfo[]> = new Map();
    private commandToKeys: Map<string, KeybindingInfo[]> = new Map();
    private docIndex: DocIndex | undefined;
    private isMac: boolean;

    constructor(private context: vscode.ExtensionContext) {
        this.isMac = process.platform === 'darwin';
        this.loadPackageJson();
        this.loadDocIndex();
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

            // Load settings/configuration
            if (pkg.contributes?.configuration?.properties) {
                const properties = pkg.contributes.configuration.properties;
                for (const [name, config] of Object.entries(properties)) {
                    const cfg = config as Record<string, unknown>;
                    this.settings.set(name, {
                        name,
                        type: (cfg.type as string) || 'unknown',
                        default: cfg.default,
                        description: cfg.description as string | undefined,
                        markdownDescription: cfg.markdownDescription as string | undefined,
                        enum: cfg.enum as string[] | undefined,
                        minimum: cfg.minimum as number | undefined,
                        maximum: cfg.maximum as number | undefined,
                    });
                }
            }
        } catch (error) {
            console.error('Failed to load package.json:', error);
        }
    }

    /**
     * Load pre-built documentation index
     */
    private loadDocIndex(): void {
        try {
            const indexPath = path.join(this.context.extensionPath, 'out', 'help', 'docIndex.json');
            if (fs.existsSync(indexPath)) {
                const content = fs.readFileSync(indexPath, 'utf8');
                this.docIndex = JSON.parse(content);
            } else {
                // Try src path for development
                const srcIndexPath = path.join(this.context.extensionPath, 'src', 'help', 'docIndex.json');
                if (fs.existsSync(srcIndexPath)) {
                    const content = fs.readFileSync(srcIndexPath, 'utf8');
                    this.docIndex = JSON.parse(content);
                }
            }
        } catch (error) {
            console.error('Failed to load documentation index:', error);
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
     * Get all settings
     */
    public getAllSettings(): SettingInfo[] {
        return Array.from(this.settings.values());
    }

    /**
     * Get setting info
     */
    public getSettingInfo(name: string): SettingInfo | undefined {
        return this.settings.get(name);
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
     * Describe Variable/Setting (C-h v) - Select a setting and show its info
     */
    public async describeVariable(): Promise<void> {
        const allSettings = this.getAllSettings();

        interface SettingQuickPickItem extends vscode.QuickPickItem {
            settingInfo: SettingInfo;
        }

        const items: SettingQuickPickItem[] = allSettings.map((setting) => {
            const desc = setting.description || setting.markdownDescription || '';
            const currentValue = vscode.workspace.getConfiguration().get(setting.name);
            const defaultStr = setting.default !== undefined
                ? `Default: ${JSON.stringify(setting.default)}`
                : '';
            const currentStr = currentValue !== undefined
                ? `Current: ${JSON.stringify(currentValue)}`
                : '';

            return {
                label: `$(symbol-variable) ${setting.name}`,
                description: `[${setting.type}]`,
                detail: desc.slice(0, 100) + (desc.length > 100 ? '...' : ''),
                settingInfo: setting,
            };
        });

        // Sort by setting name
        items.sort((a, b) => a.settingInfo.name.localeCompare(b.settingInfo.name));

        const selected = await vscode.window.showQuickPick(items, {
            title: 'Describe Setting',
            placeHolder: 'Search for a setting...',
            matchOnDescription: true,
            matchOnDetail: true,
        });

        if (selected) {
            await this.showSettingDetails(selected.settingInfo.name);
        }
    }

    /**
     * Show detailed information about a setting
     */
    private async showSettingDetails(settingName: string): Promise<void> {
        const setting = this.getSettingInfo(settingName);
        if (!setting) {
            vscode.window.showErrorMessage(`Setting not found: ${settingName}`);
            return;
        }

        const currentValue = vscode.workspace.getConfiguration().get(settingName);
        const desc = setting.markdownDescription || setting.description || 'No description';

        // Build info lines
        const lines: string[] = [];
        lines.push(`**Setting:** \`${settingName}\``);
        lines.push('');
        lines.push(`**Type:** ${setting.type}`);
        if (setting.default !== undefined) {
            lines.push(`**Default:** \`${JSON.stringify(setting.default)}\``);
        }
        lines.push(`**Current:** \`${JSON.stringify(currentValue)}\``);
        if (setting.enum) {
            lines.push(`**Options:** ${setting.enum.map(e => `\`${e}\``).join(', ')}`);
        }
        if (setting.minimum !== undefined) {
            lines.push(`**Minimum:** ${setting.minimum}`);
        }
        if (setting.maximum !== undefined) {
            lines.push(`**Maximum:** ${setting.maximum}`);
        }
        lines.push('');
        lines.push('---');
        lines.push('');
        lines.push(desc);

        const markdown = new vscode.MarkdownString(lines.join('\n'));
        markdown.isTrusted = true;

        const action = await vscode.window.showQuickPick(
            [
                { label: '$(gear) Open Settings', action: 'open' },
                { label: '$(copy) Copy Setting Name', action: 'copy' },
                { label: '$(close) Close', action: 'close' },
            ],
            {
                title: settingName,
                placeHolder: lines.slice(0, 6).join(' | '),
            }
        );

        if (action?.action === 'open') {
            await vscode.commands.executeCommand('workbench.action.openSettings', settingName);
        } else if (action?.action === 'copy') {
            await vscode.env.clipboard.writeText(settingName);
            vscode.window.showInformationMessage(`Copied: ${settingName}`);
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

    /**
     * Apropos (C-h a) - Search documentation for keywords
     */
    public async apropos(): Promise<void> {
        if (!this.docIndex) {
            vscode.window.showErrorMessage('Documentation index not loaded');
            return;
        }

        const input = await vscode.window.showInputBox({
            prompt: 'Enter keywords to search in documentation',
            placeHolder: 'e.g., export, jupyter, keybinding',
            title: 'Apropos (Documentation Search)',
        });

        if (!input || !input.trim()) {
            return;
        }

        const searchTerms = input.toLowerCase().trim().split(/\s+/);
        const results = this.searchDocumentation(searchTerms);

        if (results.length === 0) {
            vscode.window.showInformationMessage(`No documentation found for: ${input}`);
            return;
        }

        interface DocQuickPickItem extends vscode.QuickPickItem {
            entry: DocEntry;
        }

        const items: DocQuickPickItem[] = results.slice(0, 50).map(({ entry, score }) => {
            const pathStr = entry.path.length > 0 ? entry.path.join(' > ') + ' > ' : '';
            const levelIndicator = '  '.repeat(entry.level - 1) + '•';

            // Show commands and keybindings if present
            let extras: string[] = [];
            if (entry.commands.length > 0) {
                extras.push(`Commands: ${entry.commands.slice(0, 2).join(', ')}`);
            }
            if (entry.keybindings.length > 0) {
                extras.push(`Keys: ${entry.keybindings.slice(0, 2).join(', ')}`);
            }

            return {
                label: `${levelIndicator} ${entry.heading}`,
                description: `[${entry.file}:${entry.line}]`,
                detail: entry.content.slice(0, 100) + (entry.content.length > 100 ? '...' : ''),
                entry,
            };
        });

        const selected = await vscode.window.showQuickPick(items, {
            title: `Documentation: "${input}" (${results.length} results)`,
            placeHolder: 'Select to view details or open file',
            matchOnDescription: true,
            matchOnDetail: true,
        });

        if (selected) {
            await this.showDocEntryDetails(selected.entry);
        }
    }

    /**
     * Search documentation index for matching entries
     */
    private searchDocumentation(terms: string[]): { entry: DocEntry; score: number }[] {
        if (!this.docIndex) {
            return [];
        }

        const results: { entry: DocEntry; score: number }[] = [];

        for (const entry of this.docIndex.entries) {
            let score = 0;

            for (const term of terms) {
                // Check heading (highest weight)
                if (entry.heading.toLowerCase().includes(term)) {
                    score += 10;
                }

                // Check path
                for (const p of entry.path) {
                    if (p.toLowerCase().includes(term)) {
                        score += 3;
                    }
                }

                // Check commands
                for (const cmd of entry.commands) {
                    if (cmd.toLowerCase().includes(term)) {
                        score += 8;
                    }
                }

                // Check keybindings
                for (const kb of entry.keybindings) {
                    if (kb.toLowerCase().includes(term)) {
                        score += 7;
                    }
                }

                // Check keywords
                for (const kw of entry.keywords) {
                    if (kw.includes(term)) {
                        score += 5;
                    }
                }

                // Check content (lowest weight)
                if (entry.content.toLowerCase().includes(term)) {
                    score += 2;
                }
            }

            if (score > 0) {
                results.push({ entry, score });
            }
        }

        // Sort by score descending
        results.sort((a, b) => b.score - a.score);

        return results;
    }

    /**
     * Show detailed view of a documentation entry
     */
    private async showDocEntryDetails(entry: DocEntry): Promise<void> {
        const lines: string[] = [];

        // Build path
        if (entry.path.length > 0) {
            lines.push(`**Path:** ${entry.path.join(' > ')}`);
        }
        lines.push(`**Heading:** ${entry.heading}`);
        lines.push(`**File:** ${entry.file}:${entry.line}`);
        lines.push('');

        if (entry.commands.length > 0) {
            lines.push(`**Commands:** ${entry.commands.map(c => `\`${c}\``).join(', ')}`);
        }
        if (entry.keybindings.length > 0) {
            lines.push(`**Keybindings:** ${entry.keybindings.join(', ')}`);
        }
        if (entry.keywords.length > 0) {
            lines.push(`**Keywords:** ${entry.keywords.slice(0, 10).join(', ')}`);
        }

        lines.push('');
        lines.push('---');
        lines.push('');
        lines.push(entry.content);

        const action = await vscode.window.showQuickPick(
            [
                { label: '$(file) Open Documentation File', action: 'open' },
                { label: '$(copy) Copy Heading', action: 'copy' },
                { label: '$(search) Search Again', action: 'search' },
                { label: '$(close) Close', action: 'close' },
            ],
            {
                title: entry.heading,
                placeHolder: lines.slice(0, 8).join(' | ').replace(/\*\*/g, ''),
            }
        );

        if (action?.action === 'open') {
            const docsPath = path.join(this.context.extensionPath, 'docs', entry.file);
            if (fs.existsSync(docsPath)) {
                const doc = await vscode.workspace.openTextDocument(docsPath);
                const editor = await vscode.window.showTextDocument(doc);
                const position = new vscode.Position(entry.line - 1, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(
                    new vscode.Range(position, position),
                    vscode.TextEditorRevealType.InCenter
                );
            } else {
                vscode.window.showErrorMessage(`Documentation file not found: ${entry.file}`);
            }
        } else if (action?.action === 'copy') {
            await vscode.env.clipboard.writeText(entry.heading);
            vscode.window.showInformationMessage(`Copied: ${entry.heading}`);
        } else if (action?.action === 'search') {
            await this.apropos();
        }
    }
}
