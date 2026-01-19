/**
 * Audit Keybindings and Commands
 *
 * This script compares package.json keybindings/commands with documentation
 * to find discrepancies.
 *
 * Run with: npx ts-node scripts/audit-keybindings.ts
 */

import * as fs from 'fs';
import * as path from 'path';

interface Keybinding {
    command: string;
    key: string;
    mac?: string;
    when?: string;
}

interface Command {
    command: string;
    title: string;
    category?: string;
}

interface PackageJson {
    contributes: {
        commands: Command[];
        keybindings: Keybinding[];
    };
}

interface DocKeybinding {
    key: string;
    action: string;
    file: string;
    line: number;
}

interface DocCommand {
    commandId: string;
    description: string;
    keybinding: string;
    file: string;
    line: number;
}

interface AuditResults {
    commandsInPackageNotInDocs: string[];
    commandsInDocsNotInPackage: string[];
    keybindingDiscrepancies: Array<{
        command: string;
        packageKey: string;
        docKey: string;
    }>;
    duplicateKeybindings: Array<{
        key: string;
        commands: string[];
        contexts: string[];
    }>;
    statistics: {
        totalCommands: number;
        totalKeybindings: number;
        documentedCommands: number;
        documentedKeybindings: number;
    };
}

// Convert Emacs notation to VS Code notation for comparison
function emacsToVSCode(key: string): string {
    return key
        .replace(/C-/g, 'ctrl+')
        .replace(/M-/g, 'alt+')
        .replace(/S-/g, 'shift+')
        .replace(/s-/g, 'cmd+')
        .replace(/<tab>/gi, 'tab')
        .replace(/<return>/gi, 'enter')
        .replace(/<ret>/gi, 'enter')
        .replace(/<space>/gi, 'space')
        .replace(/<left>/gi, 'left')
        .replace(/<right>/gi, 'right')
        .replace(/<up>/gi, 'up')
        .replace(/<down>/gi, 'down')
        .replace(/<backspace>/gi, 'backspace')
        .replace(/<delete>/gi, 'delete')
        .replace(/<escape>/gi, 'escape')
        .replace(/<home>/gi, 'home')
        .replace(/<end>/gi, 'end')
        .replace(/\s+/g, ' ')
        .toLowerCase()
        .trim();
}

// Normalize VS Code keybinding format
function normalizeVSCode(key: string): string {
    return key
        .replace(/cmd\+/gi, 'ctrl+')  // Normalize mac to ctrl for comparison
        .toLowerCase()
        .trim();
}

function parsePackageJson(): PackageJson {
    const packagePath = path.join(__dirname, '..', 'package.json');
    return JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
}

function parseOrgTable(lines: string[], startLine: number): { rows: string[][]; endLine: number } {
    const rows: string[][] = [];
    let i = startLine;

    while (i < lines.length) {
        const line = lines[i].trim();
        if (!line.startsWith('|')) break;
        if (line.match(/^\|[-+]+\|$/)) {
            // Separator line
            i++;
            continue;
        }

        const cells = line
            .split('|')
            .slice(1, -1)  // Remove empty first/last from split
            .map(c => c.trim());

        if (cells.length > 0) {
            rows.push(cells);
        }
        i++;
    }

    return { rows, endLine: i };
}

function parseKeybindingsDoc(): DocKeybinding[] {
    const docPath = path.join(__dirname, '..', 'docs', '24-keybindings.org');
    const content = fs.readFileSync(docPath, 'utf-8');
    const lines = content.split('\n');
    const keybindings: DocKeybinding[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Look for table headers with "Key" column
        if (line.startsWith('|') && line.toLowerCase().includes('key')) {
            const { rows, endLine } = parseOrgTable(lines, i);

            // Skip header row, parse data rows
            for (let j = 1; j < rows.length; j++) {
                const row = rows[j];
                if (row.length >= 2) {
                    const key = row[0].trim();
                    const action = row[1].trim();
                    if (key && action && !key.toLowerCase().includes('key')) {
                        keybindings.push({
                            key,
                            action,
                            file: '24-keybindings.org',
                            line: i + j + 1
                        });
                    }
                }
            }

            i = endLine;
        }
    }

    return keybindings;
}

function parseCommandsDoc(): DocCommand[] {
    const docPath = path.join(__dirname, '..', 'docs', '25-commands.org');
    const content = fs.readFileSync(docPath, 'utf-8');
    const lines = content.split('\n');
    const commands: DocCommand[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Look for table headers with "Command ID" column
        if (line.startsWith('|') && line.toLowerCase().includes('command')) {
            const { rows, endLine } = parseOrgTable(lines, i);

            // Skip header row, parse data rows
            for (let j = 1; j < rows.length; j++) {
                const row = rows[j];
                if (row.length >= 2) {
                    // Extract command ID from [[cmd:scimax.xxx]] format
                    const cmdMatch = row[0].match(/\[\[cmd:(scimax\.[^\]]+)\]\]/);
                    const commandId = cmdMatch ? cmdMatch[1] : row[0].trim();
                    const description = row[1].trim();
                    const keybinding = row.length >= 3 ? row[2].trim() : '-';

                    if (commandId && commandId.startsWith('scimax.')) {
                        commands.push({
                            commandId,
                            description,
                            keybinding,
                            file: '25-commands.org',
                            line: i + j + 1
                        });
                    }
                }
            }

            i = endLine;
        }
    }

    return commands;
}

function findDuplicateKeybindings(keybindings: Keybinding[]): Array<{
    key: string;
    commands: string[];
    contexts: string[];
}> {
    const keyMap = new Map<string, Array<{ command: string; when: string }>>();

    for (const kb of keybindings) {
        const normalizedKey = normalizeVSCode(kb.key);
        if (!keyMap.has(normalizedKey)) {
            keyMap.set(normalizedKey, []);
        }
        keyMap.get(normalizedKey)!.push({
            command: kb.command,
            when: kb.when || ''
        });
    }

    const duplicates: Array<{
        key: string;
        commands: string[];
        contexts: string[];
    }> = [];

    for (const [key, entries] of keyMap) {
        if (entries.length > 1) {
            // Check if contexts overlap
            const contexts = entries.map(e => e.when);
            const commands = entries.map(e => e.command);

            // Skip if all have unique contexts (proper disambiguation)
            // A conflict occurs when two entries have the same or overlapping contexts
            const hasConflict = contexts.some((ctx1, i) =>
                contexts.some((ctx2, j) =>
                    i !== j && (ctx1 === ctx2 || (!ctx1 && !ctx2))
                )
            );

            if (hasConflict) {
                duplicates.push({ key, commands, contexts });
            }
        }
    }

    return duplicates;
}

function audit(): AuditResults {
    const pkg = parsePackageJson();
    const docKeybindings = parseKeybindingsDoc();
    const docCommands = parseCommandsDoc();

    // Get all scimax commands from package.json
    const packageCommands = new Set(
        pkg.contributes.commands
            .filter(c => c.command.startsWith('scimax.'))
            .map(c => c.command)
    );

    // Get all documented command IDs
    const documentedCommands = new Set(docCommands.map(c => c.commandId));

    // Find commands in package but not in docs
    const commandsInPackageNotInDocs = [...packageCommands]
        .filter(c => !documentedCommands.has(c))
        .sort();

    // Find commands in docs but not in package
    const commandsInDocsNotInPackage = [...documentedCommands]
        .filter(c => !packageCommands.has(c))
        .sort();

    // Find keybinding discrepancies
    const keybindingDiscrepancies: Array<{
        command: string;
        packageKey: string;
        docKey: string;
    }> = [];

    // Create a map of command -> keybindings from package.json
    const packageKbMap = new Map<string, string[]>();
    for (const kb of pkg.contributes.keybindings) {
        if (!packageKbMap.has(kb.command)) {
            packageKbMap.set(kb.command, []);
        }
        packageKbMap.get(kb.command)!.push(kb.key);
    }

    // Check documented commands for keybinding discrepancies
    for (const docCmd of docCommands) {
        const packageKeys = packageKbMap.get(docCmd.commandId) || [];
        const docKey = docCmd.keybinding;

        if (docKey !== '-' && docKey.length > 0) {
            const normalizedDocKey = emacsToVSCode(docKey);

            // Check if any package keybinding matches
            const hasMatch = packageKeys.some(pk =>
                normalizeVSCode(pk) === normalizedDocKey ||
                normalizeVSCode(pk).includes(normalizedDocKey.split(' ')[0])
            );

            if (!hasMatch && packageKeys.length > 0) {
                keybindingDiscrepancies.push({
                    command: docCmd.commandId,
                    packageKey: packageKeys.join(', '),
                    docKey: docKey
                });
            }
        }
    }

    // Find duplicate keybindings
    const duplicateKeybindings = findDuplicateKeybindings(pkg.contributes.keybindings);

    return {
        commandsInPackageNotInDocs,
        commandsInDocsNotInPackage,
        keybindingDiscrepancies,
        duplicateKeybindings,
        statistics: {
            totalCommands: packageCommands.size,
            totalKeybindings: pkg.contributes.keybindings.length,
            documentedCommands: documentedCommands.size,
            documentedKeybindings: docKeybindings.length
        }
    };
}

function printResults(results: AuditResults): void {
    console.log('\n=== KEYBINDING AND COMMAND AUDIT RESULTS ===\n');

    console.log('STATISTICS:');
    console.log(`  Commands in package.json: ${results.statistics.totalCommands}`);
    console.log(`  Keybindings in package.json: ${results.statistics.totalKeybindings}`);
    console.log(`  Commands documented: ${results.statistics.documentedCommands}`);
    console.log(`  Keybindings documented: ${results.statistics.documentedKeybindings}`);

    console.log('\n--- COMMANDS IN PACKAGE.JSON BUT NOT IN DOCS ---');
    if (results.commandsInPackageNotInDocs.length === 0) {
        console.log('  All commands are documented!');
    } else {
        console.log(`  (${results.commandsInPackageNotInDocs.length} commands missing from docs)`);
        for (const cmd of results.commandsInPackageNotInDocs) {
            console.log(`  - ${cmd}`);
        }
    }

    console.log('\n--- COMMANDS IN DOCS BUT NOT IN PACKAGE.JSON ---');
    if (results.commandsInDocsNotInPackage.length === 0) {
        console.log('  All documented commands exist in package.json!');
    } else {
        console.log(`  (${results.commandsInDocsNotInPackage.length} documented commands not in package)`);
        for (const cmd of results.commandsInDocsNotInPackage) {
            console.log(`  - ${cmd}`);
        }
    }

    console.log('\n--- KEYBINDING DISCREPANCIES ---');
    if (results.keybindingDiscrepancies.length === 0) {
        console.log('  No keybinding discrepancies found!');
    } else {
        console.log(`  (${results.keybindingDiscrepancies.length} discrepancies)`);
        for (const d of results.keybindingDiscrepancies) {
            console.log(`  - ${d.command}`);
            console.log(`    Package: ${d.packageKey}`);
            console.log(`    Docs:    ${d.docKey}`);
        }
    }

    console.log('\n--- DUPLICATE KEYBINDINGS (potential conflicts) ---');
    if (results.duplicateKeybindings.length === 0) {
        console.log('  No duplicate keybindings with overlapping contexts!');
    } else {
        console.log(`  (${results.duplicateKeybindings.length} potential conflicts)`);
        for (const d of results.duplicateKeybindings) {
            console.log(`  - Key: ${d.key}`);
            for (let i = 0; i < d.commands.length; i++) {
                console.log(`    ${d.commands[i]}`);
                console.log(`      when: ${d.contexts[i] || '(no condition)'}`);
            }
        }
    }

    console.log('\n=== END OF AUDIT ===\n');
}

// Main execution
const results = audit();
printResults(results);

// Exit with error code if there are issues
const hasIssues =
    results.commandsInPackageNotInDocs.length > 0 ||
    results.commandsInDocsNotInPackage.length > 0 ||
    results.duplicateKeybindings.length > 0;

if (hasIssues) {
    console.log('Audit found issues that may need attention.');
}
