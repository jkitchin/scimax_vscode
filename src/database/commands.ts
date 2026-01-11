import * as vscode from 'vscode';
import * as path from 'path';
import { OrgDb, HeadingRecord, SourceBlockRecord, SearchResult } from './orgDb';

export function registerDbCommands(
    context: vscode.ExtensionContext,
    db: OrgDb
): void {
    // Reindex all files
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.reindex', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showWarningMessage('No workspace folder open');
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Indexing files...',
                cancellable: false
            }, async (progress) => {
                let totalIndexed = 0;

                for (const folder of workspaceFolders) {
                    const indexed = await db.indexDirectory(folder.uri.fsPath, progress);
                    totalIndexed += indexed;
                }

                // Also index additional directories from config
                const config = vscode.workspace.getConfiguration('scimax.db');
                const additionalDirs = config.get<string[]>('directories') || [];

                for (const dir of additionalDirs) {
                    const indexed = await db.indexDirectory(dir, progress);
                    totalIndexed += indexed;
                }

                const stats = db.getStats();
                vscode.window.showInformationMessage(
                    `Indexed ${totalIndexed} files. Total: ${stats.files} files, ${stats.headings} headings, ${stats.blocks} code blocks`
                );
            });
        })
    );

    // Search all files (full text)
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.search', async () => {
            const query = await vscode.window.showInputBox({
                prompt: 'Search all org/markdown files',
                placeHolder: 'Enter search term...'
            });

            if (!query) return;

            const results = db.searchFullText(query);

            if (results.length === 0) {
                vscode.window.showInformationMessage(`No results found for "${query}"`);
                return;
            }

            const items = results.slice(0, 100).map(result => ({
                label: `$(file) ${path.basename(result.filePath)}:${result.lineNumber}`,
                description: result.preview,
                detail: result.filePath,
                result
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${results.length} results for "${query}"`,
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selected) {
                await openFileAtLine(selected.result.filePath, selected.result.lineNumber);
            }
        })
    );

    // Search headings
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.searchHeadings', async () => {
            const query = await vscode.window.showInputBox({
                prompt: 'Search headings',
                placeHolder: 'Enter heading text...'
            });

            if (!query) return;

            const results = db.searchHeadings(query);

            if (results.length === 0) {
                vscode.window.showInformationMessage(`No headings found matching "${query}"`);
                return;
            }

            const items = results.slice(0, 100).map(heading => ({
                label: `${'  '.repeat(heading.level - 1)}${getHeadingIcon(heading)} ${heading.title}`,
                description: heading.todoState || '',
                detail: `${path.basename(heading.filePath)}:${heading.lineNumber}`,
                heading
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${results.length} headings matching "${query}"`,
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selected) {
                await openFileAtLine(selected.heading.filePath, selected.heading.lineNumber);
            }
        })
    );

    // Search source blocks
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.searchBlocks', async () => {
            // First, let user pick language
            const languages = new Set(
                db.searchSourceBlocks().map(b => b.language)
            );

            const languageItems = [
                { label: '$(list-flat) All languages', language: undefined },
                ...Array.from(languages).sort().map(lang => ({
                    label: `$(code) ${lang}`,
                    language: lang
                }))
            ];

            const langChoice = await vscode.window.showQuickPick(languageItems, {
                placeHolder: 'Select language to filter'
            });

            if (!langChoice) return;

            // Then search content
            const query = await vscode.window.showInputBox({
                prompt: 'Search code blocks (optional)',
                placeHolder: 'Enter code to search for...'
            });

            const results = db.searchSourceBlocks(langChoice.language, query || undefined);

            if (results.length === 0) {
                vscode.window.showInformationMessage('No code blocks found');
                return;
            }

            const items = results.slice(0, 100).map(block => ({
                label: `$(code) ${block.language}`,
                description: block.content.split('\n')[0].slice(0, 60),
                detail: `${path.basename(block.filePath)}:${block.lineNumber}`,
                block
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${results.length} code blocks found`,
                matchOnDescription: true
            });

            if (selected) {
                await openFileAtLine(selected.block.filePath, selected.block.lineNumber);
            }
        })
    );

    // Search by hashtag
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.searchHashtags', async () => {
            const hashtags = db.getAllHashtags();

            if (hashtags.length === 0) {
                vscode.window.showInformationMessage('No hashtags found in indexed files');
                return;
            }

            const items = hashtags.map(tag => ({
                label: `#${tag}`,
                description: `${db.findByHashtag(tag).length} files`,
                tag
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a hashtag'
            });

            if (!selected) return;

            const files = db.findByHashtag(selected.tag);
            const fileItems = files.map(filePath => ({
                label: `$(file) ${path.basename(filePath)}`,
                detail: filePath,
                filePath
            }));

            const fileSelected = await vscode.window.showQuickPick(fileItems, {
                placeHolder: `Files with #${selected.tag}`
            });

            if (fileSelected) {
                const doc = await vscode.workspace.openTextDocument(fileSelected.filePath);
                await vscode.window.showTextDocument(doc);
            }
        })
    );

    // Show TODOs
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.showTodos', async () => {
            const todos = db.getTodos();

            if (todos.length === 0) {
                vscode.window.showInformationMessage('No TODO items found');
                return;
            }

            // Group by state
            const states = new Set(todos.map(t => t.todoState).filter(Boolean));
            const stateItems = [
                { label: '$(list-flat) All TODOs', state: undefined },
                ...Array.from(states).map(state => ({
                    label: `$(${getTodoIcon(state!)}) ${state}`,
                    state
                }))
            ];

            const stateChoice = await vscode.window.showQuickPick(stateItems, {
                placeHolder: 'Filter by state'
            });

            if (!stateChoice) return;

            const filtered = stateChoice.state
                ? todos.filter(t => t.todoState === stateChoice.state)
                : todos;

            const items = filtered.map(todo => ({
                label: `$(${getTodoIcon(todo.todoState!)}) ${todo.title}`,
                description: todo.todoState,
                detail: `${path.basename(todo.filePath)}:${todo.lineNumber}`,
                todo
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `${filtered.length} TODO items`
            });

            if (selected) {
                await openFileAtLine(selected.todo.filePath, selected.todo.lineNumber);
            }
        })
    );

    // Show database stats
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.db.stats', () => {
            const stats = db.getStats();
            vscode.window.showInformationMessage(
                `Scimax DB: ${stats.files} files, ${stats.headings} headings, ${stats.blocks} code blocks, ${stats.links} links`
            );
        })
    );
}

function getHeadingIcon(heading: HeadingRecord): string {
    if (heading.todoState) {
        return getTodoIcon(heading.todoState);
    }
    return '$(list-tree)';
}

function getTodoIcon(state: string): string {
    switch (state.toUpperCase()) {
        case 'TODO':
            return 'circle-outline';
        case 'DONE':
            return 'check';
        case 'IN-PROGRESS':
        case 'NEXT':
            return 'play';
        case 'WAIT':
        case 'WAITING':
            return 'watch';
        case 'CANCELLED':
            return 'x';
        default:
            return 'circle-outline';
    }
}

async function openFileAtLine(filePath: string, lineNumber: number): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc);

    const position = new vscode.Position(lineNumber - 1, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter
    );
}
