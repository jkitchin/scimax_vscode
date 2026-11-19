/**
 * Detect other extensions that break scimax's single-key global bindings by
 * using the same key as the first stroke of a chord.
 *
 * VS Code treats any key that starts a chord as a chord prefix: pressing it
 * waits for a second key, so a plain binding on that key never fires. For
 * example, Magit binds `alt+x g`, which silently disables scimax's `alt+x`
 * (M-x, workbench.action.showCommands).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { extensionLogger as log } from './logger';

const EXTENSION_ID = 'jkitchin.scimax-vscode';
const DISMISSED_KEY = 'scimax.keybindingConflicts.dismissed';

export interface ContributedKeybinding {
    command: string;
    key: string;
    when?: string;
}

export interface KeybindingConflict {
    /** Our single-stroke key that no longer fires, e.g. `alt+x`. */
    key: string;
    /** Our command bound to that key. */
    command: string;
    /** Extension that contributes the chord. */
    extensionId: string;
    extensionName: string;
    /** The other extension's chord, e.g. `alt+x g`. */
    chord: string;
    /** The other extension's command bound to the chord. */
    chordCommand: string;
}

export interface ExtensionKeybindings {
    id: string;
    name: string;
    keybindings: ContributedKeybinding[];
}

/** Normalize a key so `Alt+X  g` and `alt+x g` compare equal. */
export function normalizeKey(key: string): string {
    return key.trim().toLowerCase().split(/\s+/).join(' ');
}

/** Pick the key that applies on this platform, as VS Code does. */
export function platformKey(binding: unknown, platform: NodeJS.Platform = process.platform): string | undefined {
    if (!binding || typeof binding !== 'object') return undefined;
    const b = binding as Record<string, unknown>;
    const specific = platform === 'darwin' ? b.mac : platform === 'win32' ? b.win : b.linux;
    const key = typeof specific === 'string' ? specific : b.key;
    return typeof key === 'string' ? normalizeKey(key) : undefined;
}

/** Read the platform keybindings an extension manifest contributes. */
export function manifestKeybindings(packageJSON: unknown, platform: NodeJS.Platform = process.platform): ContributedKeybinding[] {
    const contributed = (packageJSON as { contributes?: { keybindings?: unknown } } | undefined)
        ?.contributes?.keybindings;
    const list = Array.isArray(contributed) ? contributed : contributed ? [contributed] : [];
    const result: ContributedKeybinding[] = [];
    for (const binding of list) {
        const key = platformKey(binding, platform);
        const command = (binding as { command?: unknown })?.command;
        if (!key || typeof command !== 'string') continue;
        const when = (binding as { when?: unknown }).when;
        result.push({ key, command, when: typeof when === 'string' ? when : undefined });
    }
    return result;
}

/**
 * Find chords in other extensions whose first stroke is one of our global
 * single-stroke keys. Bindings the user removed (`-command` entries in their
 * keybindings.json, given in `removed` as `key|command`) are ignored.
 */
export function findChordPrefixConflicts(
    ours: ContributedKeybinding[],
    others: ExtensionKeybindings[],
    removed: Set<string> = new Set()
): KeybindingConflict[] {
    const singles = ours.filter(b => !b.when && !b.key.includes(' ') && !b.command.startsWith('-'));
    const conflicts: KeybindingConflict[] = [];
    for (const single of singles) {
        for (const ext of others) {
            for (const binding of ext.keybindings) {
                if (binding.command.startsWith('-')) continue;
                if (!binding.key.startsWith(single.key + ' ')) continue;
                if (removed.has(`${binding.key}|${binding.command}`)) continue;
                conflicts.push({
                    key: single.key,
                    command: single.command,
                    extensionId: ext.id,
                    extensionName: ext.name,
                    chord: binding.key,
                    chordCommand: binding.command,
                });
            }
        }
    }
    return conflicts;
}

/** Strip comments and trailing commas so keybindings.json parses as JSON. */
export function parseJsonc(text: string): unknown {
    let out = '';
    let inString = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            out += ch;
            if (ch === '\\') { out += text[++i] ?? ''; continue; }
            if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; out += ch; continue; }
        if (ch === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') i++;
            out += '\n';
            continue;
        }
        if (ch === '/' && text[i + 1] === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
            i++;
            continue;
        }
        out += ch;
    }
    return JSON.parse(out.replace(/,(\s*[\]}])/g, '$1'));
}

/** `key|command` pairs the user removed with `-command` entries. */
export function removedBindings(userKeybindings: unknown, platform: NodeJS.Platform = process.platform): Set<string> {
    const removed = new Set<string>();
    if (!Array.isArray(userKeybindings)) return removed;
    for (const entry of userKeybindings) {
        const command = (entry as { command?: unknown })?.command;
        const key = platformKey(entry, platform);
        if (typeof command === 'string' && command.startsWith('-') && key) {
            removed.add(`${key}|${command.slice(1)}`);
        }
    }
    return removed;
}

/** keybindings.json entries that remove the conflicting chords. */
export function fixSnippet(conflicts: KeybindingConflict[]): string {
    const lines = conflicts.map(c =>
        `  { "key": ${JSON.stringify(c.chord)}, "command": ${JSON.stringify('-' + c.chordCommand)} }`);
    return lines.join(',\n');
}

/**
 * Best-effort read of the user's keybindings.json. The global storage folder
 * lives in the User folder, which is also where keybindings.json lives.
 */
function readUserKeybindings(context: vscode.ExtensionContext): unknown {
    const userDir = path.resolve(context.globalStorageUri.fsPath, '..', '..');
    const file = path.join(userDir, 'keybindings.json');
    try {
        return parseJsonc(fs.readFileSync(file, 'utf8'));
    } catch {
        return undefined;
    }
}

/** Collect current conflicts from the installed extensions. */
export function currentConflicts(context: vscode.ExtensionContext): KeybindingConflict[] {
    const self = vscode.extensions.getExtension(EXTENSION_ID);
    if (!self) return [];
    const ours = manifestKeybindings(self.packageJSON);
    const others: ExtensionKeybindings[] = vscode.extensions.all
        .filter(ext => ext.id.toLowerCase() !== EXTENSION_ID)
        .map(ext => ({
            id: ext.id,
            name: (ext.packageJSON?.displayName as string) || ext.id,
            keybindings: manifestKeybindings(ext.packageJSON),
        }))
        .filter(ext => ext.keybindings.length > 0);
    return findChordPrefixConflicts(ours, others, removedBindings(readUserKeybindings(context)));
}

function describe(conflicts: KeybindingConflict[]): string {
    const byKey = new Map<string, KeybindingConflict[]>();
    for (const c of conflicts) {
        byKey.set(c.key, [...(byKey.get(c.key) ?? []), c]);
    }
    return [...byKey.entries()].map(([key, list]) => {
        const exts = [...new Set(list.map(c => c.extensionName))].join(', ');
        const chords = list.map(c => c.chord).join(', ');
        return `${key} (${list[0].command}) is blocked by ${exts}, which binds ${chords}`;
    }).join('; ');
}

/**
 * Warn about conflicts. Startup checks stay quiet once the user dismissed the
 * same set of conflicts; a manual check always reports.
 */
export async function checkKeybindingConflicts(
    context: vscode.ExtensionContext,
    manual = false
): Promise<void> {
    const conflicts = currentConflicts(context);
    if (conflicts.length === 0) {
        if (manual) {
            vscode.window.showInformationMessage('Scimax: no keybinding conflicts found.');
        }
        return;
    }

    const signature = conflicts.map(c => `${c.extensionId}:${c.chord}|${c.chordCommand}`).sort().join(',');
    if (!manual && context.globalState.get<string>(DISMISSED_KEY) === signature) return;

    log.warn(`Keybinding conflicts: ${describe(conflicts)}`);

    const fix = 'Copy Fix & Open Keybindings';
    const dismiss = "Don't Show Again";
    const choice = await vscode.window.showWarningMessage(
        `Scimax: ${describe(conflicts)}. A key that starts a chord waits for a second key, so the scimax binding never fires.`,
        fix,
        dismiss
    );

    if (choice === fix) {
        await vscode.env.clipboard.writeText(fixSnippet(conflicts));
        await vscode.commands.executeCommand('workbench.action.openGlobalKeybindingsFile');
        vscode.window.showInformationMessage(
            'Scimax: removal entries copied. Paste them inside the [ ] of keybindings.json and save.');
    } else if (choice === dismiss) {
        await context.globalState.update(DISMISSED_KEY, signature);
    }
}

/** Check on startup, whenever extensions change, and on demand. */
export function registerKeybindingConflictCheck(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.checkKeybindingConflicts',
            () => checkKeybindingConflicts(context, true)),
        vscode.extensions.onDidChange(() => {
            void checkKeybindingConflicts(context);
        })
    );
    void checkKeybindingConflicts(context);
}
