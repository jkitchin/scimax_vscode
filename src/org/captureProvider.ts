/**
 * Org-mode Capture Provider
 * VS Code integration for org-capture with template picker UI and file targeting
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    CaptureTemplate,
    CaptureContext,
    CaptureTarget,
    CaptureLocation,
    captureTemplateRegistry,
    expandTemplate,
    parseTemplate,
    createCaptureContext,
    capture,
    generateDatetreePath,
} from '../parser/orgCapture';
import { parseOrg } from '../parser/orgParserUnified';
import type { HeadlineElement, OrgDocumentNode } from '../parser/orgElementTypes';
import { expandTilde, getDefaultCaptureFile, resolveFilePath as sharedResolveFilePath } from '../utils/pathResolver';

// =============================================================================
// Configuration
// =============================================================================

interface CaptureConfig {
    /** Default directory for capture files */
    defaultDirectory: string;
    /** User-defined templates */
    templates: CaptureTemplateConfig[];
    /** Whether to show preview before capture */
    showPreview: boolean;
    /** Whether to open file after capture */
    openAfterCapture: boolean;
}

interface CaptureTemplateConfig {
    key: string;
    name: string;
    description?: string;
    file: string;
    target?: {
        type: 'file' | 'headline' | 'file+headline' | 'file+datetree';
        headline?: string;
        prepend?: boolean;
    };
    template: string;
    properties?: Record<string, string>;
    tags?: string[];
}

function loadConfig(): CaptureConfig {
    const config = vscode.workspace.getConfiguration('scimax.capture');
    return {
        defaultDirectory: config.get<string>('defaultDirectory', ''),
        templates: config.get<CaptureTemplateConfig[]>('templates', []),
        showPreview: config.get<boolean>('showPreview', true),
        openAfterCapture: config.get<boolean>('openAfterCapture', true),
    };
}

// =============================================================================
// Template Management
// =============================================================================

/**
 * Load user-defined templates from configuration
 */
function loadUserTemplates(): void {
    const config = loadConfig();

    for (const templateConfig of config.templates) {
        const template: CaptureTemplate = {
            key: templateConfig.key,
            name: templateConfig.name,
            description: templateConfig.description,
            file: resolveFilePath(templateConfig.file, config.defaultDirectory),
            target: templateConfig.target as CaptureTarget,
            template: templateConfig.template,
            properties: templateConfig.properties,
            tags: templateConfig.tags,
        };

        captureTemplateRegistry.register(template);
    }
}

/**
 * Resolve file path with default directory
 * Uses shared utilities for consistent path resolution across Scimax
 */
function resolveFilePath(filePath: string, defaultDir: string): string {
    // If no file path provided, use the default capture file
    if (!filePath) {
        return getDefaultCaptureFile();
    }

    // Use shared path resolution utility
    return sharedResolveFilePath(filePath, defaultDir || getDefaultCaptureFile());
}

// =============================================================================
// Target Resolution
// =============================================================================

/**
 * Resolve capture target to a specific location
 */
async function resolveTarget(
    template: CaptureTemplate,
    context: CaptureContext
): Promise<CaptureLocation> {
    const filePath = resolveFilePath(template.file, loadConfig().defaultDirectory);

    // Ensure file exists
    if (!fs.existsSync(filePath)) {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, '');
    }

    const target = template.target;

    if (!target) {
        // Default: append to end of file
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        return {
            file: filePath,
            line: lines.length,
            level: 1,
        };
    }

    switch (target.type) {
        case 'file':
            return resolveFileTarget(filePath, target.prepend);

        case 'headline':
        case 'file+headline':
            return resolveHeadlineTarget(filePath, target.headline || '', target.prepend);

        case 'file+datetree':
            return resolveDatetreeTarget(filePath, context.date);

        default:
            return {
                file: filePath,
                line: 0,
                level: 1,
            };
    }
}

/**
 * Resolve file target (beginning or end of file)
 */
function resolveFileTarget(filePath: string, prepend?: boolean): CaptureLocation {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    if (prepend) {
        // Find first non-keyword line
        let line = 0;
        for (let i = 0; i < lines.length; i++) {
            if (!lines[i].startsWith('#') && lines[i].trim() !== '') {
                line = i;
                break;
            }
            line = i + 1;
        }
        return { file: filePath, line, level: 1 };
    }

    return {
        file: filePath,
        line: lines.length,
        level: 1,
    };
}

/**
 * Resolve headline target
 */
function resolveHeadlineTarget(
    filePath: string,
    headlineText: string,
    prepend?: boolean
): CaptureLocation {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Find matching headline
    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^(\*+)\s+(.+)$/);
        if (match && match[2].trim() === headlineText.trim()) {
            const level = match[1].length;

            if (prepend) {
                // Insert right after headline
                return {
                    file: filePath,
                    line: i + 1,
                    level: level + 1,
                };
            }

            // Find end of this subtree
            let endLine = i + 1;
            while (endLine < lines.length) {
                const nextMatch = lines[endLine].match(/^(\*+)\s/);
                if (nextMatch && nextMatch[1].length <= level) {
                    break;
                }
                endLine++;
            }

            return {
                file: filePath,
                line: endLine,
                level: level + 1,
            };
        }
    }

    // Headline not found - create it at end
    return {
        file: filePath,
        line: lines.length,
        level: 1,
    };
}

/**
 * Resolve datetree target
 */
function resolveDatetreeTarget(filePath: string, date: Date): CaptureLocation {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    const [yearHeading, monthHeading, dayHeading] = generateDatetreePath(date);

    let yearLine = -1;
    let monthLine = -1;
    let dayLine = -1;

    // Find or track where to insert year/month/day
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check for year
        if (line.match(new RegExp(`^\\* ${yearHeading.split(' ')[0]}\\b`))) {
            yearLine = i;
            monthLine = -1; // Reset month search
            dayLine = -1;
        }

        // Check for month (within year)
        if (yearLine >= 0 && line.match(/^\*\* \d{4}-\d{2}/)) {
            if (line.includes(monthHeading.split(' ')[0])) {
                monthLine = i;
                dayLine = -1;
            }
        }

        // Check for day (within month)
        if (monthLine >= 0 && line.match(/^\*\*\* \d{4}-\d{2}-\d{2}/)) {
            if (line.includes(dayHeading.split(' ')[0])) {
                dayLine = i;
            }
        }
    }

    // Build missing datetree structure
    let insertPos = lines.length;
    let insertContent = '';

    if (yearLine < 0) {
        insertContent = `* ${yearHeading}\n** ${monthHeading}\n*** ${dayHeading}\n`;
        return {
            file: filePath,
            line: insertPos,
            level: 4,
        };
    }

    if (monthLine < 0) {
        // Find end of year section
        insertPos = findSectionEnd(lines, yearLine, 1);
        insertContent = `** ${monthHeading}\n*** ${dayHeading}\n`;
        return {
            file: filePath,
            line: insertPos,
            level: 4,
        };
    }

    if (dayLine < 0) {
        // Find end of month section
        insertPos = findSectionEnd(lines, monthLine, 2);
        insertContent = `*** ${dayHeading}\n`;
        return {
            file: filePath,
            line: insertPos,
            level: 4,
        };
    }

    // Day exists - find end of day section
    insertPos = findSectionEnd(lines, dayLine, 3);
    return {
        file: filePath,
        line: insertPos,
        level: 4,
    };
}

/**
 * Find the end of a section (where next same/higher level heading starts)
 */
function findSectionEnd(lines: string[], startLine: number, level: number): number {
    for (let i = startLine + 1; i < lines.length; i++) {
        const match = lines[i].match(/^(\*+)\s/);
        if (match && match[1].length <= level) {
            return i;
        }
    }
    return lines.length;
}

// =============================================================================
// Capture Execution
// =============================================================================

/**
 * Execute capture with UI
 */
async function executeCapture(template: CaptureTemplate): Promise<void> {
    const config = loadConfig();

    // Get current context
    const editor = vscode.window.activeTextEditor;
    const selection = editor?.selection;
    const selectedText = editor && selection ? editor.document.getText(selection) : '';

    // Create initial context
    let context = createCaptureContext(template, {
        initialContent: selectedText || await vscode.env.clipboard.readText(),
        sourceFile: editor?.document.uri.fsPath,
        sourceLine: selection ? selection.start.line + 1 : undefined,
    });

    // Get required prompts
    const tokens = parseTemplate(template.template);
    const prompts = tokens.filter(t => t.type === 'placeholder' && t.required);

    // Collect user inputs
    for (const prompt of prompts) {
        const input = await vscode.window.showInputBox({
            prompt: prompt.value,
            value: prompt.default || '',
            placeHolder: prompt.value,
        });

        if (input === undefined) {
            // User cancelled
            return;
        }

        context.inputs[prompt.value] = input;
    }

    // Handle tag prompts
    const tagPrompts = tokens.filter(t => t.value === '^g' || t.value === '^G');
    if (tagPrompts.length > 0) {
        const tagsInput = await vscode.window.showInputBox({
            prompt: 'Tags (comma separated)',
            placeHolder: 'tag1, tag2, tag3',
        });

        if (tagsInput !== undefined) {
            context.inputs['^g'] = tagsInput.split(',').map(t => t.trim()).filter(t => t).join(':');
        }
    }

    // Expand template
    const capturedContent = await capture(template, context);

    // Show preview if enabled
    if (config.showPreview) {
        const action = await vscode.window.showInformationMessage(
            'Preview capture content?',
            { modal: false },
            'Capture',
            'Preview',
            'Cancel'
        );

        if (action === 'Cancel') {
            return;
        }

        if (action === 'Preview') {
            const doc = await vscode.workspace.openTextDocument({
                content: capturedContent,
                language: 'org',
            });
            await vscode.window.showTextDocument(doc, { preview: true });

            const confirm = await vscode.window.showInformationMessage(
                'Confirm capture?',
                'Capture',
                'Cancel'
            );

            if (confirm !== 'Capture') {
                return;
            }
        }
    }

    // Resolve target location
    const location = await resolveTarget(template, context);

    // Insert content
    await insertCapture(location, capturedContent);

    // Open file if configured
    if (config.openAfterCapture) {
        const doc = await vscode.workspace.openTextDocument(location.file);
        const editor = await vscode.window.showTextDocument(doc);

        // Move cursor to insertion point
        const pos = new vscode.Position(location.line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos));
    }

    vscode.window.showInformationMessage(`Captured to ${path.basename(location.file)}`);
}

/**
 * Insert captured content at location
 */
async function insertCapture(location: CaptureLocation, content: string): Promise<void> {
    const fileContent = fs.existsSync(location.file)
        ? fs.readFileSync(location.file, 'utf-8')
        : '';

    const lines = fileContent.split('\n');

    // Adjust content for proper indentation/level
    let adjustedContent = content;
    if (location.level && location.level > 1) {
        // Adjust heading levels in content
        adjustedContent = content.replace(/^(\*+)/gm, (match) => {
            return '*'.repeat(match.length + location.level! - 1);
        });
    }

    // Ensure content ends with newline
    if (!adjustedContent.endsWith('\n')) {
        adjustedContent += '\n';
    }

    // Insert content
    lines.splice(location.line, 0, adjustedContent);

    // Write back
    fs.writeFileSync(location.file, lines.join('\n'));
}

// =============================================================================
// Template Picker UI
// =============================================================================

interface TemplateQuickPickItem extends vscode.QuickPickItem {
    template: CaptureTemplate;
}

/**
 * Show template picker and execute capture
 */
async function showTemplatePicker(): Promise<void> {
    const templates = captureTemplateRegistry.getAll();

    if (templates.length === 0) {
        vscode.window.showWarningMessage('No capture templates defined. Configure templates in settings.');
        return;
    }

    const items: TemplateQuickPickItem[] = templates.map(template => ({
        label: `$(${getTemplateIcon(template)}) [${template.key}] ${template.name}`,
        description: template.description,
        detail: `Target: ${template.file}`,
        template,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a capture template',
        matchOnDescription: true,
    });

    if (selected) {
        await executeCapture(selected.template);
    }
}

/**
 * Get icon for template based on its type
 */
function getTemplateIcon(template: CaptureTemplate): string {
    if (template.name.toLowerCase().includes('todo')) return 'tasklist';
    if (template.name.toLowerCase().includes('note')) return 'note';
    if (template.name.toLowerCase().includes('journal')) return 'calendar';
    if (template.name.toLowerCase().includes('meeting')) return 'organization';
    if (template.name.toLowerCase().includes('code') || template.name.toLowerCase().includes('snippet')) return 'code';
    if (template.name.toLowerCase().includes('bookmark')) return 'bookmark';
    return 'file';
}

/**
 * Capture by key (like org-capture dispatch)
 */
async function captureByKey(key: string): Promise<void> {
    const template = captureTemplateRegistry.get(key);

    if (!template) {
        vscode.window.showWarningMessage(`No template with key '${key}'`);
        return;
    }

    await executeCapture(template);
}

// =============================================================================
// Quick Capture Commands
// =============================================================================

/**
 * Quick TODO capture
 */
async function quickTodo(): Promise<void> {
    const task = await vscode.window.showInputBox({
        prompt: 'Task',
        placeHolder: 'What needs to be done?',
    });

    if (!task) return;

    const template = captureTemplateRegistry.get('t');
    if (!template) {
        vscode.window.showWarningMessage('TODO template not found');
        return;
    }

    const context = createCaptureContext(template, {});
    context.inputs['Task'] = task;

    const content = await capture(template, context);
    const location = await resolveTarget(template, context);
    await insertCapture(location, content);

    vscode.window.showInformationMessage(`TODO added: ${task}`);
}

/**
 * Quick note capture
 */
async function quickNote(): Promise<void> {
    const title = await vscode.window.showInputBox({
        prompt: 'Note title',
        placeHolder: 'Note title',
    });

    if (!title) return;

    const template = captureTemplateRegistry.get('n');
    if (!template) {
        vscode.window.showWarningMessage('Note template not found');
        return;
    }

    const context = createCaptureContext(template, {});
    context.inputs['Title'] = title;

    const content = await capture(template, context);
    const location = await resolveTarget(template, context);
    await insertCapture(location, content);

    vscode.window.showInformationMessage(`Note added: ${title}`);
}

// =============================================================================
// Template Editor
// =============================================================================

/**
 * Create a new capture template interactively
 */
async function createTemplate(): Promise<void> {
    const key = await vscode.window.showInputBox({
        prompt: 'Template key (single letter or short string)',
        placeHolder: 'e.g., t, n, j',
        validateInput: (value) => {
            if (!value || value.length > 5) {
                return 'Key should be 1-5 characters';
            }
            if (captureTemplateRegistry.get(value)) {
                return 'Template with this key already exists';
            }
            return null;
        },
    });

    if (!key) return;

    const name = await vscode.window.showInputBox({
        prompt: 'Template name',
        placeHolder: 'e.g., Todo, Note, Meeting',
    });

    if (!name) return;

    const file = await vscode.window.showInputBox({
        prompt: 'Target file (relative to workspace or absolute)',
        placeHolder: 'e.g., todo.org, ~/notes/notes.org',
    });

    if (!file) return;

    const targetTypeOptions = [
        { label: 'End of file', value: 'file' },
        { label: 'Under specific headline', value: 'file+headline' },
        { label: 'Date tree', value: 'file+datetree' },
    ];

    const targetType = await vscode.window.showQuickPick(targetTypeOptions, {
        placeHolder: 'Where to insert captured content?',
    });

    if (!targetType) return;

    let headline: string | undefined;
    if (targetType.value === 'file+headline') {
        headline = await vscode.window.showInputBox({
            prompt: 'Target headline text',
            placeHolder: 'e.g., Tasks, Inbox',
        });
        if (!headline) return;
    }

    const template = await vscode.window.showInputBox({
        prompt: 'Template (use %^{Prompt} for input, %t for timestamp)',
        placeHolder: '* TODO %^{Task}\n%?',
        value: '* TODO %^{Task}\n%?',
    });

    if (!template) return;

    // Create template configuration
    const templateConfig: CaptureTemplateConfig = {
        key,
        name,
        file,
        target: {
            type: targetType.value as 'file' | 'file+headline' | 'file+datetree',
            headline,
        },
        template: template.replace(/\\n/g, '\n'),
    };

    // Add to configuration
    const config = vscode.workspace.getConfiguration('scimax.capture');
    const templates = config.get<CaptureTemplateConfig[]>('templates', []);
    templates.push(templateConfig);

    await config.update('templates', templates, vscode.ConfigurationTarget.Global);

    // Reload templates
    loadUserTemplates();

    vscode.window.showInformationMessage(`Template '${name}' created with key '${key}'`);
}

// =============================================================================
// Commands Registration
// =============================================================================

export function registerCaptureCommands(context: vscode.ExtensionContext): void {
    // Load user templates on activation
    loadUserTemplates();

    // Watch for config changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('scimax.capture')) {
                loadUserTemplates();
            }
        })
    );

    context.subscriptions.push(
        // Main capture command
        vscode.commands.registerCommand('scimax.capture', showTemplatePicker),

        // Capture by key
        vscode.commands.registerCommand('scimax.captureByKey', async () => {
            const key = await vscode.window.showInputBox({
                prompt: 'Template key',
                placeHolder: 't, n, j, m...',
            });
            if (key) {
                await captureByKey(key);
            }
        }),

        // Quick captures
        vscode.commands.registerCommand('scimax.capture.todo', quickTodo),
        vscode.commands.registerCommand('scimax.capture.note', quickNote),

        // Template management
        vscode.commands.registerCommand('scimax.capture.createTemplate', createTemplate),

        vscode.commands.registerCommand('scimax.capture.listTemplates', () => {
            const templates = captureTemplateRegistry.getAll();
            const content = templates.map(t =>
                `[${t.key}] ${t.name}\n  File: ${t.file}\n  Template: ${t.template.slice(0, 50)}...`
            ).join('\n\n');

            vscode.workspace.openTextDocument({ content, language: 'text' })
                .then(doc => vscode.window.showTextDocument(doc));
        }),

        vscode.commands.registerCommand('scimax.capture.configure', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'scimax.capture');
        })
    );
}
