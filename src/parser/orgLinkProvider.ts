import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Excalidraw file extensions
const EXCALIDRAW_EXTENSIONS = ['.excalidraw', '.excalidraw.json', '.excalidraw.svg', '.excalidraw.png'];

/**
 * Check if a file path is an Excalidraw file
 */
function isExcalidrawFile(filePath: string): boolean {
    const lowerPath = filePath.toLowerCase();
    return EXCALIDRAW_EXTENSIONS.some(ext => lowerPath.endsWith(ext));
}

/**
 * Document link provider for org-mode links
 * Makes [[link][description]] clickable
 */
export class OrgLinkProvider implements vscode.DocumentLinkProvider {
    provideDocumentLinks(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.DocumentLink[] {
        const links: vscode.DocumentLink[] = [];
        const text = document.getText();

        // Match [[target][description]] or [[target]]
        const regex = /\[\[([^\]]+)\](?:\[([^\]]+)\])?\]/g;

        let match;
        while ((match = regex.exec(text)) !== null) {
            const target = match[1];
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);

            const link = new vscode.DocumentLink(range);
            const resolvedTarget = this.resolveTarget(target, document);

            if (resolvedTarget) {
                link.target = resolvedTarget;
            }

            link.tooltip = this.getTooltip(target);
            links.push(link);
        }

        // Find radio targets <<<target>>> and make all occurrences of target text clickable
        const radioTargetRegex = /<<<([^>]+)>>>/g;
        const radioTargets: { text: string; position: number }[] = [];

        while ((match = radioTargetRegex.exec(text)) !== null) {
            radioTargets.push({
                text: match[1],
                position: match.index
            });
        }

        // For each radio target, find all occurrences of its text and make them links
        for (const radioTarget of radioTargets) {
            const targetText = radioTarget.text;
            const targetLower = targetText.toLowerCase();
            const lowerText = text.toLowerCase();
            let searchStart = 0;

            while (true) {
                const index = lowerText.indexOf(targetLower, searchStart);
                if (index === -1) break;

                // Skip if this is the radio target definition itself (<<<...>>>)
                const prefixStart = Math.max(0, index - 3);
                const prefix = text.substring(prefixStart, index);
                const suffix = text.substring(index + targetText.length, index + targetText.length + 3);
                const isDefinition = prefix.endsWith('<<<') && suffix.startsWith('>>>');

                if (!isDefinition) {
                    const startPos = document.positionAt(index);
                    const endPos = document.positionAt(index + targetText.length);
                    const range = new vscode.Range(startPos, endPos);

                    const link = new vscode.DocumentLink(range);
                    link.target = vscode.Uri.parse(
                        `command:scimax.org.gotoRadioTarget?${encodeURIComponent(JSON.stringify({
                            file: document.uri.fsPath,
                            target: targetText
                        }))}`
                    );
                    link.tooltip = `Go to radio target: <<<${targetText}>>>`;
                    links.push(link);
                }

                searchStart = index + targetText.length;
            }
        }

        // Find bare citation links: cite:key, citet:&key1;&key2, etc.
        // Supports both v2 (cite:key1,key2) and v3 (cite:&key1;&key2) syntax
        const citationRegex = /(?<![[\w])(cite[pt]?|citeauthor|citeyear|Citep|Citet|citealp|citealt|citenum):([\w:,&;-]+)/g;
        while ((match = citationRegex.exec(text)) !== null) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);

            const citeCommand = match[1];
            const citePath = match[2];

            // Extract keys for tooltip
            let keys: string[];
            if (citePath.includes('&')) {
                // v3 format: extract keys that follow &
                const keyMatches = citePath.match(/&([\w:-]+)/g) || [];
                keys = keyMatches.map(k => k.slice(1));
            } else {
                // v2 format: comma-separated
                keys = citePath.split(',').map(k => k.trim());
            }

            const link = new vscode.DocumentLink(range);
            link.target = vscode.Uri.parse(
                `command:scimax.ref.gotoCitation?${encodeURIComponent(JSON.stringify({
                    key: keys[0],
                    keys: keys
                }))}`
            );
            link.tooltip = `Citation: ${keys.join(', ')}`;
            links.push(link);
        }

        // Find footnote references: [fn:label] or [fn:label:definition] or [fn::definition]
        // Make them clickable to jump to their definitions
        const footnoteRegex = /\[fn:([^:\]]*)?(?::([^\]]*))?\]/g;
        while ((match = footnoteRegex.exec(text)) !== null) {
            const label = match[1] || '';
            const inlineDefinition = match[2];

            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);

            // Check if this is a definition at the start of a line (not a reference)
            const isDefinition = startPos.character === 0;

            const link = new vscode.DocumentLink(range);

            if (isDefinition) {
                // This is a footnote definition - don't make it clickable to itself
                // But we could make it find all references (future enhancement)
                continue;
            }

            if (inlineDefinition !== undefined) {
                // Inline footnote - no navigation needed, just show tooltip
                link.tooltip = `Inline footnote: ${inlineDefinition}`;
            } else if (label) {
                // Standard footnote reference - navigate to definition
                link.target = vscode.Uri.parse(
                    `command:scimax.org.gotoFootnote?${encodeURIComponent(JSON.stringify({
                        file: document.uri.fsPath,
                        label: label
                    }))}`
                );
                link.tooltip = `Go to footnote definition: [fn:${label}]`;
            } else {
                // Anonymous footnote without definition
                link.tooltip = 'Anonymous footnote';
            }

            links.push(link);
        }

        return links;
    }

    /**
     * Resolve link target to a URI
     */
    private resolveTarget(target: string, document: vscode.TextDocument): vscode.Uri | undefined {
        const docDir = path.dirname(document.uri.fsPath);

        // HTTP/HTTPS links
        if (target.startsWith('http://') || target.startsWith('https://')) {
            return vscode.Uri.parse(target);
        }

        // DOI links
        if (target.startsWith('doi:')) {
            return vscode.Uri.parse(`https://doi.org/${target.slice(4)}`);
        }

        // Command links: cmd:command.name or cmd:command.name?args - execute VS Code commands
        // Supports: cmd:command (no args), cmd:command?stringArg, cmd:command?{"json":"args"}
        if (target.startsWith('cmd:')) {
            const cmdPart = target.slice(4);
            const questionIdx = cmdPart.indexOf('?');

            if (questionIdx === -1) {
                // No arguments
                return vscode.Uri.parse(`command:${cmdPart}`);
            }

            const command = cmdPart.slice(0, questionIdx);
            const argsStr = cmdPart.slice(questionIdx + 1);

            // Parse arguments - try JSON first, otherwise treat as string
            let args: unknown;
            try {
                args = JSON.parse(argsStr);
            } catch {
                // Not JSON - use as plain string argument
                args = argsStr;
            }

            // VS Code command URIs expect args as JSON-encoded array or single value
            return vscode.Uri.parse(
                `command:${command}?${encodeURIComponent(JSON.stringify(args))}`
            );
        }

        // File links: file:path or file:path::search
        if (target.startsWith('file:')) {
            const filePart = target.slice(5);
            return this.resolveFileLink(filePart, docDir);
        }

        // Internal heading link: *Heading
        if (target.startsWith('*')) {
            const heading = target.slice(1);
            return vscode.Uri.parse(
                `command:scimax.org.gotoHeading?${encodeURIComponent(JSON.stringify({
                    file: document.uri.fsPath,
                    heading: heading
                }))}`
            );
        }

        // Internal custom ID link: #custom-id
        if (target.startsWith('#')) {
            const customId = target.slice(1);
            return vscode.Uri.parse(
                `command:scimax.org.gotoCustomId?${encodeURIComponent(JSON.stringify({
                    file: document.uri.fsPath,
                    customId: customId
                }))}`
            );
        }

        // ID link: id:uuid - searches for :ID: property across files
        if (target.startsWith('id:')) {
            const id = target.slice(3);
            return vscode.Uri.parse(
                `command:scimax.org.gotoId?${encodeURIComponent(JSON.stringify({
                    id: id
                }))}`
            );
        }

        // Bare file path (no file: prefix) - common in org-mode
        if (target.includes('/') || target.includes('\\') ||
            target.endsWith('.org') || target.endsWith('.md') ||
            target.endsWith('.pdf') || target.endsWith('.png') ||
            target.endsWith('.jpg') || target.endsWith('.txt')) {
            return this.resolveFileLink(target, docDir);
        }

        // File with search: path::*heading or path::search
        if (target.includes('::')) {
            return this.resolveFileLink(target, docDir);
        }

        // Internal target link: [[target-name]] - searches for <<target-name>>, #+NAME:, or text
        return vscode.Uri.parse(
            `command:scimax.org.gotoTarget?${encodeURIComponent(JSON.stringify({
                file: document.uri.fsPath,
                target: target
            }))}`
        );
    }

    /**
     * Resolve a file link, possibly with search component
     */
    private resolveFileLink(filePart: string, docDir: string): vscode.Uri | undefined {
        let filePath: string;
        let search: string | undefined;

        // Split on :: for search component
        if (filePart.includes('::')) {
            const parts = filePart.split('::');
            filePath = parts[0];
            search = parts[1];
        } else {
            filePath = filePart;
        }

        // Resolve relative paths
        if (!path.isAbsolute(filePath)) {
            filePath = path.resolve(docDir, filePath);
        }

        // Expand ~ to home directory
        if (filePath.startsWith('~')) {
            const homeDir = process.env.HOME || process.env.USERPROFILE || '';
            filePath = path.join(homeDir, filePath.slice(1));
        }

        // If there's a heading search, use command
        if (search && search.startsWith('*')) {
            return vscode.Uri.parse(
                `command:scimax.org.gotoHeading?${encodeURIComponent(JSON.stringify({
                    file: filePath,
                    heading: search.slice(1)
                }))}`
            );
        }

        // If there's a custom ID search
        if (search && search.startsWith('#')) {
            return vscode.Uri.parse(
                `command:scimax.org.gotoCustomId?${encodeURIComponent(JSON.stringify({
                    file: filePath,
                    customId: search.slice(1)
                }))}`
            );
        }

        // If there's a character offset search (::c1234)
        if (search && search.startsWith('c') && /^c\d+$/.test(search)) {
            const charOffset = parseInt(search.slice(1));
            return vscode.Uri.parse(
                `command:scimax.org.gotoCharOffset?${encodeURIComponent(JSON.stringify({
                    file: filePath,
                    charOffset: charOffset
                }))}`
            );
        }

        // If there's a line number search, use VS Code's fragment syntax
        if (search && /^\d+$/.test(search)) {
            const lineNum = parseInt(search);
            // VS Code supports #L<line> fragment for jumping to lines
            return vscode.Uri.file(filePath).with({ fragment: `L${lineNum}` });
        }

        // If there's a text search
        if (search) {
            return vscode.Uri.parse(
                `command:scimax.org.gotoSearch?${encodeURIComponent(JSON.stringify({
                    file: filePath,
                    search: search
                }))}`
            );
        }

        // Excalidraw files - open with Excalidraw editor
        if (isExcalidrawFile(filePath)) {
            return vscode.Uri.parse(
                `command:scimax.org.openExcalidraw?${encodeURIComponent(JSON.stringify({
                    file: filePath
                }))}`
            );
        }

        // Plain file - open directly
        return vscode.Uri.file(filePath);
    }

    /**
     * Get tooltip for link
     */
    private getTooltip(target: string): string {
        if (target.startsWith('http://') || target.startsWith('https://')) {
            return `Open URL: ${target}`;
        }
        if (target.startsWith('doi:')) {
            return `Open DOI: ${target.slice(4)}`;
        }
        // Excalidraw files
        if (isExcalidrawFile(target)) {
            return `Open Excalidraw drawing: ${target}`;
        }
        if (target.startsWith('cmd:')) {
            const cmdPart = target.slice(4);
            const questionIdx = cmdPart.indexOf('?');
            if (questionIdx === -1) {
                return `Run command: ${cmdPart}`;
            }
            const command = cmdPart.slice(0, questionIdx);
            const args = cmdPart.slice(questionIdx + 1);
            return `Run command: ${command} with args: ${args}`;
        }
        if (target.startsWith('file:')) {
            return `Open file: ${target.slice(5)}`;
        }
        if (target.startsWith('*')) {
            return `Go to heading: ${target.slice(1)}`;
        }
        if (target.includes('::')) {
            const [file, search] = target.split('::');
            return `Open ${file} at ${search}`;
        }
        return `Open: ${target}`;
    }
}

/**
 * Register org-link commands for navigation
 */
export function registerOrgLinkCommands(context: vscode.ExtensionContext): void {
    // Go to heading in file
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.gotoHeading', async (args: { file: string; heading: string }) => {
            const { file, heading } = args;

            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const editor = await vscode.window.showTextDocument(doc);

                // Search for the heading
                const text = doc.getText();
                const lines = text.split('\n');
                const headingLower = heading.toLowerCase();

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    // Match org heading: * Heading or ** Heading etc
                    const match = line.match(/^(\*+)\s+(.*)$/);
                    if (match) {
                        // Extract title without TODO state, priority, tags
                        let title = match[2];
                        // Remove TODO state
                        title = title.replace(/^(TODO|DONE|NEXT|WAIT|CANCELLED|IN-PROGRESS|WAITING)\s+/, '');
                        // Remove priority
                        title = title.replace(/^\[#[A-Z]\]\s+/, '');
                        // Remove tags
                        title = title.replace(/\s+:[^:]+:$/, '');
                        title = title.trim();

                        if (title.toLowerCase() === headingLower ||
                            title.toLowerCase().includes(headingLower)) {
                            const position = new vscode.Position(i, 0);
                            editor.selection = new vscode.Selection(position, position);
                            editor.revealRange(
                                new vscode.Range(position, position),
                                vscode.TextEditorRevealType.InCenter
                            );
                            return;
                        }
                    }
                }

                vscode.window.showWarningMessage(`Heading not found: ${heading}`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to open file: ${file}`);
            }
        })
    );

    // Go to line in file
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.gotoLine', async (args: { file: string; line: number }) => {
            const { file, line } = args;

            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const editor = await vscode.window.showTextDocument(doc);

                const position = new vscode.Position(line - 1, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(
                    new vscode.Range(position, position),
                    vscode.TextEditorRevealType.InCenter
                );
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to open file: ${file}`);
            }
        })
    );

    // Go to search match in file
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.gotoSearch', async (args: { file: string; search: string }) => {
            const { file, search } = args;

            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const editor = await vscode.window.showTextDocument(doc);

                const text = doc.getText();
                const searchLower = search.toLowerCase();
                const index = text.toLowerCase().indexOf(searchLower);

                if (index !== -1) {
                    const position = doc.positionAt(index);
                    editor.selection = new vscode.Selection(position, position);
                    editor.revealRange(
                        new vscode.Range(position, position),
                        vscode.TextEditorRevealType.InCenter
                    );
                } else {
                    vscode.window.showWarningMessage(`Search text not found: ${search}`);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to open file: ${file}`);
            }
        })
    );

    // Go to custom ID in file
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.gotoCustomId', async (args: { file: string; customId: string }) => {
            const { file, customId } = args;

            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const editor = await vscode.window.showTextDocument(doc);

                const text = doc.getText();
                const lines = text.split('\n');
                const customIdLower = customId.toLowerCase();

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const match = line.match(/:CUSTOM_ID:\s*(.+)/i);
                    if (match && match[1].trim().toLowerCase() === customIdLower) {
                        const position = new vscode.Position(i, 0);
                        editor.selection = new vscode.Selection(position, position);
                        editor.revealRange(
                            new vscode.Range(position, position),
                            vscode.TextEditorRevealType.InCenter
                        );
                        return;
                    }
                }

                vscode.window.showWarningMessage(`Custom ID not found: #${customId}`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to open file: ${file}`);
            }
        })
    );

    // Go to character offset in file
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.gotoCharOffset', async (args: { file: string; charOffset: number }) => {
            const { file, charOffset } = args;

            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const editor = await vscode.window.showTextDocument(doc);

                const position = doc.positionAt(charOffset);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(
                    new vscode.Range(position, position),
                    vscode.TextEditorRevealType.InCenter
                );
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to open file: ${file}`);
            }
        })
    );

    // Go to ID (search for :ID: property across files)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.gotoId', async (args: { id: string }) => {
            const { id } = args;
            const idLower = id.toLowerCase();

            // Helper function to find ID in a document and navigate to it
            async function findAndNavigateToId(doc: vscode.TextDocument): Promise<boolean> {
                const text = doc.getText();
                const lines = text.split('\n');

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const match = line.match(/:ID:\s*(.+)/i);
                    if (match && match[1].trim().toLowerCase() === idLower) {
                        const editor = await vscode.window.showTextDocument(doc);
                        // Navigate to the heading above this property
                        // Search backwards for a heading
                        let headingLine = i;
                        for (let j = i - 1; j >= 0; j--) {
                            if (lines[j].match(/^\*+\s/)) {
                                headingLine = j;
                                break;
                            }
                        }
                        const position = new vscode.Position(headingLine, 0);
                        editor.selection = new vscode.Selection(position, position);
                        editor.revealRange(
                            new vscode.Range(position, position),
                            vscode.TextEditorRevealType.InCenter
                        );
                        return true;
                    }
                }
                return false;
            }

            try {
                // First, search in the active document
                const activeEditor = vscode.window.activeTextEditor;
                if (activeEditor) {
                    const found = await findAndNavigateToId(activeEditor.document);
                    if (found) {
                        return;
                    }
                }

                // Search across all org files in the workspace
                const orgFiles = await vscode.workspace.findFiles('**/*.org', '**/node_modules/**');

                for (const fileUri of orgFiles) {
                    // Skip the active file (already searched)
                    if (activeEditor && fileUri.fsPath === activeEditor.document.uri.fsPath) {
                        continue;
                    }

                    try {
                        const doc = await vscode.workspace.openTextDocument(fileUri);
                        const found = await findAndNavigateToId(doc);
                        if (found) {
                            return;
                        }
                    } catch {
                        // Skip files that can't be opened
                        continue;
                    }
                }

                vscode.window.showWarningMessage(`ID not found: ${id}`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to search for ID: ${id}`);
            }
        })
    );

    // Go to target (<<target>>, #+NAME:, or text search)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.gotoTarget', async (args: { file: string; target: string }) => {
            const { file, target } = args;
            const targetLower = target.toLowerCase();

            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const editor = await vscode.window.showTextDocument(doc);
                const text = doc.getText();
                const lines = text.split('\n');

                // First, search for #+NAME:
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const nameMatch = line.match(/^#\+NAME:\s*(.+)$/i);
                    if (nameMatch && nameMatch[1].trim().toLowerCase() === targetLower) {
                        const position = new vscode.Position(i, 0);
                        editor.selection = new vscode.Selection(position, position);
                        editor.revealRange(
                            new vscode.Range(position, position),
                            vscode.TextEditorRevealType.InCenter
                        );
                        return;
                    }
                }

                // Search for <<target>>
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const targetMatch = line.match(/<<([^>]+)>>/);
                    if (targetMatch && targetMatch[1].trim().toLowerCase() === targetLower) {
                        const col = line.indexOf('<<');
                        const position = new vscode.Position(i, col);
                        editor.selection = new vscode.Selection(position, position);
                        editor.revealRange(
                            new vscode.Range(position, position),
                            vscode.TextEditorRevealType.InCenter
                        );
                        return;
                    }
                }

                // Fallback: plain text search
                const index = text.toLowerCase().indexOf(targetLower);
                if (index !== -1) {
                    const position = doc.positionAt(index);
                    editor.selection = new vscode.Selection(position, position);
                    editor.revealRange(
                        new vscode.Range(position, position),
                        vscode.TextEditorRevealType.InCenter
                    );
                    return;
                }

                vscode.window.showWarningMessage(`Target not found: ${target}`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to open file: ${file}`);
            }
        })
    );

    // Go to radio target (<<<target>>>)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.gotoRadioTarget', async (args: { file: string; target: string }) => {
            const { file, target } = args;
            const targetLower = target.toLowerCase();

            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const editor = await vscode.window.showTextDocument(doc);
                const text = doc.getText();

                // Search for <<<target>>>
                const regex = /<<<([^>]+)>>>/g;
                let match;
                while ((match = regex.exec(text)) !== null) {
                    if (match[1].toLowerCase() === targetLower) {
                        const position = doc.positionAt(match.index);
                        editor.selection = new vscode.Selection(position, position);
                        editor.revealRange(
                            new vscode.Range(position, position),
                            vscode.TextEditorRevealType.InCenter
                        );
                        return;
                    }
                }

                vscode.window.showWarningMessage(`Radio target not found: <<<${target}>>>`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to open file: ${file}`);
            }
        })
    );

    // Go to footnote definition
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.gotoFootnote', async (args: { file: string; label: string }) => {
            const { file, label } = args;
            const labelLower = label.toLowerCase();

            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const editor = await vscode.window.showTextDocument(doc);
                const text = doc.getText();
                const lines = text.split('\n');

                // Search for footnote definition: [fn:label] at start of line
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const defMatch = line.match(/^\[fn:([^\]]+)\]/);
                    if (defMatch && defMatch[1].toLowerCase() === labelLower) {
                        const position = new vscode.Position(i, 0);
                        editor.selection = new vscode.Selection(position, position);
                        editor.revealRange(
                            new vscode.Range(position, position),
                            vscode.TextEditorRevealType.InCenter
                        );
                        return;
                    }
                }

                vscode.window.showWarningMessage(`Footnote definition not found: [fn:${label}]`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to open file: ${file}`);
            }
        })
    );

    // Open Excalidraw file with the Excalidraw editor
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.openExcalidraw', async (args: { file: string }) => {
            const { file } = args;

            try {
                const uri = vscode.Uri.file(file);

                // Check if file exists; if not, create an empty Excalidraw file
                if (!fs.existsSync(file)) {
                    // Create directory if needed
                    const dir = path.dirname(file);
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }

                    // Create empty Excalidraw JSON structure
                    const emptyExcalidraw = {
                        type: 'excalidraw',
                        version: 2,
                        source: 'scimax-vscode',
                        elements: [],
                        appState: {
                            viewBackgroundColor: '#ffffff'
                        },
                        files: {}
                    };

                    fs.writeFileSync(file, JSON.stringify(emptyExcalidraw, null, 2));
                }

                // Open with Excalidraw editor
                await vscode.commands.executeCommand('vscode.openWith', uri, 'editor.excalidraw');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to open Excalidraw file: ${file}`);
            }
        })
    );
}
