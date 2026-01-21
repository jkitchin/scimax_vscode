/**
 * Template system commands for VS Code
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { TemplateManager, Template, TemplateFormat } from './templateManager';

interface TemplateQuickPickItem extends vscode.QuickPickItem {
    template: Template;
}

/**
 * Register all template-related commands
 */
export function registerTemplateCommands(
    context: vscode.ExtensionContext,
    manager: TemplateManager
): void {
    // Insert template at cursor
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.templates.insert', async () => {
            const template = await selectTemplate(manager, 'Insert Template');
            if (template) {
                await manager.insertTemplate(template);
            }
        })
    );

    // Insert template for specific format
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.templates.insertOrg', async () => {
            const template = await selectTemplate(manager, 'Insert Org Template', 'org');
            if (template) {
                await manager.insertTemplate(template);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.templates.insertMarkdown', async () => {
            const template = await selectTemplate(manager, 'Insert Markdown Template', 'markdown');
            if (template) {
                await manager.insertTemplate(template);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.templates.insertLatex', async () => {
            const template = await selectTemplate(manager, 'Insert LaTeX Template', 'latex');
            if (template) {
                await manager.insertTemplate(template);
            }
        })
    );

    // Create new file from template
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.templates.newFile', async () => {
            const template = await selectTemplate(manager, 'New File from Template');
            if (template) {
                await manager.createFileFromTemplate(template);
            }
        })
    );

    // Create new file with format filter
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.templates.newOrgFile', async () => {
            const template = await selectTemplate(manager, 'New Org File from Template', 'org');
            if (template) {
                await manager.createFileFromTemplate(template);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.templates.newMarkdownFile', async () => {
            const template = await selectTemplate(manager, 'New Markdown File from Template', 'markdown');
            if (template) {
                await manager.createFileFromTemplate(template);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.templates.newLatexFile', async () => {
            const template = await selectTemplate(manager, 'New LaTeX File from Template', 'latex');
            if (template) {
                await manager.createFileFromTemplate(template);
            }
        })
    );

    // Create template from selection
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.templates.createFromSelection', async () => {
            await manager.createTemplateFromSelection();
        })
    );

    // Open templates directory
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.templates.openDirectory', async () => {
            await manager.openTemplatesDirectory();
        })
    );

    // Open templates in VS Code
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.templates.editTemplates', async () => {
            await manager.openTemplatesInEditor();
        })
    );

    // List all templates
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.templates.list', async () => {
            const templates = manager.getAvailableTemplates();
            const items: TemplateQuickPickItem[] = templates.map(t => ({
                label: `$(file) ${t.name}`,
                description: t.format.toUpperCase(),
                detail: t.description + (t.builtIn ? '' : ' (User)'),
                template: t,
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Available templates',
                matchOnDescription: true,
                matchOnDetail: true,
            });

            if (selected) {
                // Show actions for the selected template
                const action = await vscode.window.showQuickPick([
                    { label: '$(add) Insert at Cursor', action: 'insert' },
                    { label: '$(new-file) Create New File', action: 'newFile' },
                    ...(selected.template.filePath ? [
                        { label: '$(edit) Edit Template', action: 'edit' },
                    ] : []),
                ], {
                    placeHolder: `Action for "${selected.template.name}"`,
                });

                if (action) {
                    switch (action.action) {
                        case 'insert':
                            await manager.insertTemplate(selected.template);
                            break;
                        case 'newFile':
                            await manager.createFileFromTemplate(selected.template);
                            break;
                        case 'edit':
                            if (selected.template.filePath) {
                                const doc = await vscode.workspace.openTextDocument(selected.template.filePath);
                                await vscode.window.showTextDocument(doc);
                            }
                            break;
                    }
                }
            }
        })
    );

    // Quick insert based on current file type
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.templates.quickInsert', async () => {
            const editor = vscode.window.activeTextEditor;
            let format: TemplateFormat | undefined;

            if (editor) {
                const ext = path.extname(editor.document.fileName).toLowerCase();
                if (ext === '.org') {
                    format = 'org';
                } else if (ext === '.md' || ext === '.markdown') {
                    format = 'markdown';
                } else if (ext === '.tex' || ext === '.latex') {
                    format = 'latex';
                }
            }

            const template = await selectTemplate(
                manager,
                format ? `Insert ${format.charAt(0).toUpperCase() + format.slice(1)} Template` : 'Insert Template',
                format
            );

            if (template) {
                await manager.insertTemplate(template);
            }
        })
    );

    // Reload templates
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.templates.reload', () => {
            manager.reloadConfig();
            vscode.window.showInformationMessage('Templates reloaded');
        })
    );
}

/**
 * Show quick pick for template selection
 */
async function selectTemplate(
    manager: TemplateManager,
    title: string,
    format?: TemplateFormat
): Promise<Template | undefined> {
    const templates = manager.getAvailableTemplates(format);

    if (templates.length === 0) {
        vscode.window.showInformationMessage(
            format
                ? `No ${format} templates available. Create one using "Create Template from Selection".`
                : 'No templates available.'
        );
        return undefined;
    }

    // Group templates by category
    const byCategory = new Map<string, Template[]>();
    for (const template of templates) {
        const category = template.category || 'Other';
        if (!byCategory.has(category)) {
            byCategory.set(category, []);
        }
        byCategory.get(category)!.push(template);
    }

    // Build quick pick items with category separators
    const items: (TemplateQuickPickItem | vscode.QuickPickItem)[] = [];
    const categories = Array.from(byCategory.keys()).sort();

    for (const category of categories) {
        // Add separator
        items.push({
            label: category,
            kind: vscode.QuickPickItemKind.Separator,
        });

        // Add templates in this category
        const categoryTemplates = byCategory.get(category)!;
        for (const template of categoryTemplates.sort((a, b) => a.name.localeCompare(b.name))) {
            const icon = getIconForFormat(template.format);
            items.push({
                label: `${icon} ${template.name}`,
                description: template.builtIn ? template.format.toUpperCase() : `${template.format.toUpperCase()} (User)`,
                detail: template.description,
                template,
            } as TemplateQuickPickItem);
        }
    }

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: title,
        matchOnDescription: true,
        matchOnDetail: true,
    });

    if (selected && 'template' in selected) {
        return selected.template;
    }

    return undefined;
}

function getIconForFormat(format: TemplateFormat): string {
    switch (format) {
        case 'org':
            return '$(file-text)';
        case 'markdown':
            return '$(markdown)';
        case 'latex':
            return '$(symbol-operator)';
        default:
            return '$(file)';
    }
}
