import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

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

        return undefined;
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

        // If there's a line number search
        if (search && /^\d+$/.test(search)) {
            return vscode.Uri.parse(
                `command:scimax.org.gotoLine?${encodeURIComponent(JSON.stringify({
                    file: filePath,
                    line: parseInt(search)
                }))}`
            );
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
}
