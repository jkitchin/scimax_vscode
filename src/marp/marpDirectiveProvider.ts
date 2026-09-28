/**
 * Completion and hover for Marp directives in Marp decks, in the front matter
 * and in HTML comments. See marpDirectives.ts.
 */

import * as vscode from 'vscode';
import { isMarpText } from './slideRenderer';
import { marpThemeUris } from './marpSettings';
import { BUILTIN_THEMES, DIRECTIVES, directiveAt, directiveContext, findDirective, themeNames } from './marpDirectives';

function linesOf(document: vscode.TextDocument): string[] {
    return document.getText().split(/\r?\n/);
}

/** Built-in themes and the ones declared by `scimax.marp.themes` files. */
async function availableThemes(document: vscode.TextDocument): Promise<string[]> {
    const names = [...BUILTIN_THEMES];
    for (const uri of marpThemeUris(document)) {
        try {
            names.push(...themeNames(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')));
        } catch {
            // Missing theme file.
        }
    }
    return [...new Set(names)];
}

class DirectiveCompletionProvider implements vscode.CompletionItemProvider {
    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[] | undefined> {
        if (!isMarpText(document.getText())) {
            return undefined;
        }
        const context = directiveContext(linesOf(document), position.line, position.character);
        if (!context) {
            return undefined;
        }

        if (context.kind === 'name') {
            const range = new vscode.Range(position.translate(0, -context.prefix.length), position);
            const items: vscode.CompletionItem[] = [];
            for (const spec of DIRECTIVES) {
                const names = spec.scope === 'local' && context.region === 'comment' ? [spec.name, `_${spec.name}`] : [spec.name];
                for (const name of names) {
                    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Property);
                    item.insertText = `${name}: `;
                    item.range = range;
                    item.detail = name.startsWith('_')
                        ? 'Marp directive (this slide only)'
                        : spec.scope === 'global' ? 'Marp global directive' : 'Marp directive (this and later slides)';
                    item.documentation = new vscode.MarkdownString(spec.description);
                    // Show the underscore forms after the plain ones.
                    item.sortText = (name.startsWith('_') ? '1' : '0') + name;
                    item.command = spec.values ? { command: 'editor.action.triggerSuggest', title: 'Suggest values' } : undefined;
                    items.push(item);
                }
            }
            return items;
        }

        const spec = findDirective(context.directive);
        if (!spec) {
            return undefined;
        }
        const values = spec.name === 'theme' ? await availableThemes(document) : spec.values;
        if (!values) {
            return undefined;
        }
        const range = new vscode.Range(position.translate(0, -context.prefix.length), position);
        return values.map(value => {
            const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Value);
            item.range = range;
            item.detail = `${spec.name} value`;
            return item;
        });
    }
}

class DirectiveHoverProvider implements vscode.HoverProvider {
    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
        if (!isMarpText(document.getText())) {
            return undefined;
        }
        const found = directiveAt(linesOf(document), position.line, position.character);
        const spec = found ? findDirective(found.name) : undefined;
        if (!found || !spec) {
            return undefined;
        }
        const scope = found.name.startsWith('_')
            ? 'Local directive, this slide only'
            : spec.scope === 'global' ? 'Global directive' : 'Local directive, this and later slides';
        const markdown = new vscode.MarkdownString(`**${found.name}** (${scope})\n\n${spec.description}`);
        if (spec.values) {
            markdown.appendMarkdown(`\n\nValues: ${spec.values.map(v => `\`${v}\``).join(', ')}`);
        }
        return new vscode.Hover(markdown, new vscode.Range(position.line, found.start, position.line, found.end));
    }
}

export function registerMarpDirectiveProviders(context: vscode.ExtensionContext): void {
    const selector: vscode.DocumentSelector = { language: 'markdown' };
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(selector, new DirectiveCompletionProvider(), ':', ' ', '_'),
        vscode.languages.registerHoverProvider(selector, new DirectiveHoverProvider())
    );
}
