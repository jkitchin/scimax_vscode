/**
 * Document Template System for Scimax
 *
 * Provides yasnippet/skeleton-like template functionality for org, markdown, and LaTeX files.
 * Templates support:
 * - Tab stops: ${1:placeholder} - user types to replace, Tab moves to next
 * - Named variables: ${name} - prompted or auto-filled
 * - Auto-fill variables: {{date}}, {{time}}, {{filename}}, {{author}}, etc.
 * - Highlighted placeholders: <<<REPLACE_ME>>> - obvious text to replace manually
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { format } from 'date-fns';
import { resolveScimaxPath, expandTilde } from '../utils/pathResolver';

export type TemplateFormat = 'org' | 'markdown' | 'latex';

export interface Template {
    /** Unique identifier for the template */
    id: string;
    /** Display name */
    name: string;
    /** Description of the template */
    description: string;
    /** File format: org, markdown, or latex */
    format: TemplateFormat;
    /** Template content with placeholders */
    content: string;
    /** Default filename pattern (optional) */
    defaultFilename?: string;
    /** Category for grouping in menus */
    category?: string;
    /** Whether this is a built-in template */
    builtIn: boolean;
    /** File path for user templates */
    filePath?: string;
}

export interface TemplateConfig {
    /** Directory where user templates are stored */
    directory: string;
    /** Default format for new templates */
    defaultFormat: TemplateFormat;
    /** Date format for {{date}} variable */
    dateFormat: string;
    /** Time format for {{time}} variable */
    timeFormat: string;
    /** Author name for {{author}} variable */
    author: string;
}

interface TemplateVariable {
    name: string;
    defaultValue?: string;
    description?: string;
}

export class TemplateManager {
    private context: vscode.ExtensionContext;
    private config: TemplateConfig;
    private userTemplatesCache: Map<string, Template> = new Map();
    private fileWatcher?: vscode.FileSystemWatcher;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.config = this.loadConfig();
        this.setupFileWatcher();
        this.loadUserTemplates();
    }

    private loadConfig(): TemplateConfig {
        const vsConfig = vscode.workspace.getConfiguration('scimax.templates');

        return {
            directory: resolveScimaxPath('scimax.templates.directory', 'templates'),
            defaultFormat: vsConfig.get<TemplateFormat>('defaultFormat') || 'org',
            dateFormat: vsConfig.get<string>('dateFormat') || 'yyyy-MM-dd',
            timeFormat: vsConfig.get<string>('timeFormat') || 'HH:mm',
            author: vsConfig.get<string>('author') || process.env.USER || 'Author',
        };
    }

    public reloadConfig(): void {
        this.config = this.loadConfig();
        this.loadUserTemplates();
    }

    private setupFileWatcher(): void {
        // Watch for changes in user templates directory
        if (fs.existsSync(this.config.directory)) {
            this.fileWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(this.config.directory, '**/*.{org,md,tex,template}')
            );

            this.fileWatcher.onDidChange(() => this.loadUserTemplates());
            this.fileWatcher.onDidCreate(() => this.loadUserTemplates());
            this.fileWatcher.onDidDelete(() => this.loadUserTemplates());

            this.context.subscriptions.push(this.fileWatcher);
        }
    }

    /**
     * Get the templates directory path
     */
    public getTemplatesDirectory(): string {
        return this.config.directory;
    }

    /**
     * Ensure templates directory exists
     */
    public async ensureTemplatesDirectory(): Promise<void> {
        // Create all directories in parallel (recursive: true handles non-existent parents)
        await Promise.all([
            fs.promises.mkdir(this.config.directory, { recursive: true }),
            fs.promises.mkdir(path.join(this.config.directory, 'org'), { recursive: true }),
            fs.promises.mkdir(path.join(this.config.directory, 'markdown'), { recursive: true }),
            fs.promises.mkdir(path.join(this.config.directory, 'latex'), { recursive: true })
        ]);
    }

    /**
     * Load user templates from the templates directory
     */
    private loadUserTemplates(): void {
        this.userTemplatesCache.clear();

        if (!fs.existsSync(this.config.directory)) {
            return;
        }

        const loadFromDir = (dir: string, format?: TemplateFormat) => {
            if (!fs.existsSync(dir)) {
                return;
            }

            const files = fs.readdirSync(dir);
            for (const file of files) {
                const filePath = path.join(dir, file);
                const stat = fs.statSync(filePath);

                if (stat.isDirectory()) {
                    // Subdirectory - determine format from directory name
                    const subFormat = this.getFormatFromDirName(file);
                    loadFromDir(filePath, subFormat);
                } else if (stat.isFile()) {
                    const template = this.loadTemplateFromFile(filePath, format);
                    if (template) {
                        this.userTemplatesCache.set(template.id, template);
                    }
                }
            }
        };

        loadFromDir(this.config.directory);
    }

    private getFormatFromDirName(dirName: string): TemplateFormat | undefined {
        const lower = dirName.toLowerCase();
        if (lower === 'org' || lower === 'org-mode') {
            return 'org';
        }
        if (lower === 'markdown' || lower === 'md') {
            return 'markdown';
        }
        if (lower === 'latex' || lower === 'tex') {
            return 'latex';
        }
        return undefined;
    }

    private getFormatFromExtension(ext: string): TemplateFormat {
        switch (ext.toLowerCase()) {
            case '.org':
                return 'org';
            case '.md':
            case '.markdown':
                return 'markdown';
            case '.tex':
            case '.latex':
                return 'latex';
            default:
                return this.config.defaultFormat;
        }
    }

    private loadTemplateFromFile(filePath: string, format?: TemplateFormat): Template | null {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const ext = path.extname(filePath);
            const baseName = path.basename(filePath, ext);

            // Parse template metadata from header comments
            const metadata = this.parseTemplateMetadata(content, ext);

            return {
                id: `user:${baseName}`,
                name: metadata.name || this.formatTemplateName(baseName),
                description: metadata.description || `User template: ${baseName}`,
                format: format || metadata.format || this.getFormatFromExtension(ext),
                content: metadata.content,
                defaultFilename: metadata.defaultFilename,
                category: metadata.category || 'User Templates',
                builtIn: false,
                filePath,
            };
        } catch {
            return null;
        }
    }

    private parseTemplateMetadata(content: string, ext: string): {
        name?: string;
        description?: string;
        format?: TemplateFormat;
        defaultFilename?: string;
        category?: string;
        content: string;
    } {
        const lines = content.split('\n');
        const metadata: Record<string, string> = {};
        let contentStartIndex = 0;

        // Parse metadata from header comments based on file type
        const commentPatterns = {
            '.org': /^#\+(\w+):\s*(.*)$/,
            '.md': /^<!--\s*(\w+):\s*(.*?)\s*-->$/,
            '.tex': /^%\s*(\w+):\s*(.*)$/,
            '.template': /^#\s*(\w+):\s*(.*)$/,
        };

        const pattern = commentPatterns[ext as keyof typeof commentPatterns] || commentPatterns['.template'];

        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(pattern);
            if (match) {
                metadata[match[1].toLowerCase()] = match[2];
                contentStartIndex = i + 1;
            } else if (lines[i].trim() !== '') {
                // Stop parsing metadata at first non-metadata, non-empty line
                break;
            } else {
                contentStartIndex = i + 1;
            }
        }

        return {
            name: metadata['name'] || metadata['title'],
            description: metadata['description'],
            format: metadata['format'] as TemplateFormat | undefined,
            defaultFilename: metadata['filename'] || metadata['defaultfilename'],
            category: metadata['category'],
            content: lines.slice(contentStartIndex).join('\n'),
        };
    }

    private formatTemplateName(baseName: string): string {
        return baseName
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
    }

    /**
     * Get all available templates, optionally filtered by format
     */
    public getAvailableTemplates(format?: TemplateFormat): Template[] {
        const templates: Template[] = [];

        // Add built-in templates
        const builtIn = this.getBuiltInTemplates();
        templates.push(...builtIn);

        // Add user templates
        for (const template of this.userTemplatesCache.values()) {
            templates.push(template);
        }

        // Filter by format if specified
        if (format) {
            return templates.filter(t => t.format === format);
        }

        return templates;
    }

    /**
     * Get a template by ID
     */
    public getTemplate(id: string): Template | undefined {
        // Check user templates first
        if (this.userTemplatesCache.has(id)) {
            return this.userTemplatesCache.get(id);
        }

        // Check built-in templates
        const builtIn = this.getBuiltInTemplates();
        return builtIn.find(t => t.id === id);
    }

    /**
     * Process template content, replacing variables with values
     */
    public async processTemplate(template: Template, variables?: Record<string, string>): Promise<{
        content: string;
        snippetContent: string;
        cursorOffset?: number;
    }> {
        let content = template.content;

        // First, replace auto-fill variables
        content = this.replaceAutoFillVariables(content);

        // Then, handle named variables (prompt user for values)
        const namedVars = this.extractNamedVariables(content);
        const userVars = variables || {};

        for (const varInfo of namedVars) {
            if (!(varInfo.name in userVars)) {
                // Prompt user for this variable
                const value = await vscode.window.showInputBox({
                    prompt: varInfo.description || `Enter value for ${varInfo.name}`,
                    value: varInfo.defaultValue,
                    placeHolder: varInfo.defaultValue,
                });

                if (value === undefined) {
                    // User cancelled
                    throw new Error('Template insertion cancelled');
                }
                userVars[varInfo.name] = value;
            }
        }

        // Replace named variables
        for (const [name, value] of Object.entries(userVars)) {
            const pattern = new RegExp(`\\$\\{${name}\\}`, 'g');
            content = content.replace(pattern, value);
        }

        // Convert tab stops to VS Code snippet format
        const snippetContent = this.convertToSnippet(content);

        // Find cursor position (if $0 or ${0} exists)
        const cursorMatch = content.match(/\$\{?0\}?/);
        const cursorOffset = cursorMatch ? content.indexOf(cursorMatch[0]) : undefined;

        // Remove remaining tab stop markers for plain content
        const plainContent = content.replace(/\$\{?\d+(?::[^}]*)?\}?/g, match => {
            const defaultMatch = match.match(/\$\{?\d+:([^}]*)\}?/);
            return defaultMatch ? defaultMatch[1] : '';
        });

        return {
            content: plainContent,
            snippetContent,
            cursorOffset,
        };
    }

    private replaceAutoFillVariables(content: string): string {
        const now = new Date();
        const editor = vscode.window.activeTextEditor;
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

        const replacements: Record<string, string> = {
            'date': format(now, this.config.dateFormat),
            'time': format(now, this.config.timeFormat),
            'datetime': format(now, `${this.config.dateFormat} ${this.config.timeFormat}`),
            'year': format(now, 'yyyy'),
            'month': format(now, 'MM'),
            'day': format(now, 'dd'),
            'weekday': format(now, 'EEEE'),
            'timestamp': format(now, "yyyy-MM-dd'T'HH:mm:ss"),
            'author': this.config.author,
            'user': process.env.USER || process.env.USERNAME || 'user',
            'filename': editor ? path.basename(editor.document.fileName, path.extname(editor.document.fileName)) : 'untitled',
            'filepath': editor ? editor.document.fileName : '',
            'directory': editor ? path.dirname(editor.document.fileName) : '',
            'workspace': workspaceFolder ? workspaceFolder.name : '',
            'workspacePath': workspaceFolder ? workspaceFolder.uri.fsPath : '',
            'uuid': this.generateUUID(),
        };

        // Replace {{variable}} patterns
        return content.replace(/\{\{(\w+)\}\}/g, (_, name) => {
            return replacements[name.toLowerCase()] || `{{${name}}}`;
        });
    }

    private extractNamedVariables(content: string): TemplateVariable[] {
        const variables: TemplateVariable[] = [];
        const seen = new Set<string>();

        // Match ${name} or ${name:default} patterns (excluding numeric tab stops)
        const pattern = /\$\{([a-zA-Z_]\w*)(?::([^}]*))?\}/g;
        let match;

        while ((match = pattern.exec(content)) !== null) {
            const name = match[1];
            if (!seen.has(name)) {
                seen.add(name);
                variables.push({
                    name,
                    defaultValue: match[2],
                });
            }
        }

        return variables;
    }

    private convertToSnippet(content: string): string {
        // Tab stops are already in snippet format: ${1:placeholder}
        // Just need to escape $ that aren't part of tab stops
        return content.replace(/\$(?!\{?\d)/g, '\\$');
    }

    private generateUUID(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Insert a template at the current cursor position
     */
    public async insertTemplate(template: Template): Promise<boolean> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return false;
        }

        try {
            const { snippetContent } = await this.processTemplate(template);

            // Use VS Code's snippet insertion for tab stop support
            await editor.insertSnippet(new vscode.SnippetString(snippetContent));
            return true;
        } catch (error) {
            if (error instanceof Error && error.message === 'Template insertion cancelled') {
                return false;
            }
            vscode.window.showErrorMessage(`Failed to insert template: ${error}`);
            return false;
        }
    }

    /**
     * Create a new file from a template
     */
    public async createFileFromTemplate(template: Template, targetDir?: string): Promise<vscode.Uri | undefined> {
        try {
            // Determine target directory
            let directory = targetDir;
            if (!directory) {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    directory = workspaceFolder.uri.fsPath;
                } else {
                    // Ask user to select directory
                    const selected = await vscode.window.showOpenDialog({
                        canSelectFiles: false,
                        canSelectFolders: true,
                        canSelectMany: false,
                        openLabel: 'Select Directory',
                    });
                    if (!selected || selected.length === 0) {
                        return undefined;
                    }
                    directory = selected[0].fsPath;
                }
            }

            // Determine filename
            const ext = this.getExtensionForFormat(template.format);
            const defaultName = template.defaultFilename || `new-${template.id.replace(/[^a-zA-Z0-9]/g, '-')}`;

            const filename = await vscode.window.showInputBox({
                prompt: 'Enter filename',
                value: `${defaultName}${ext}`,
                valueSelection: [0, defaultName.length],
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'Filename cannot be empty';
                    }
                    const fullPath = path.join(directory!, value);
                    if (fs.existsSync(fullPath)) {
                        return 'File already exists';
                    }
                    return null;
                },
            });

            if (!filename) {
                return undefined;
            }

            const filePath = path.join(directory, filename);
            const { content } = await this.processTemplate(template);

            // Write file
            await fs.promises.writeFile(filePath, content, 'utf-8');

            // Open the file
            const uri = vscode.Uri.file(filePath);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);

            // If there are tab stops, trigger snippet mode
            if (template.content.match(/\$\{?\d/)) {
                // Select all and re-insert as snippet to enable tab stops
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    const fullRange = new vscode.Range(
                        doc.positionAt(0),
                        doc.positionAt(doc.getText().length)
                    );
                    await editor.edit(edit => edit.delete(fullRange));
                    const { snippetContent } = await this.processTemplate(template);
                    await editor.insertSnippet(new vscode.SnippetString(snippetContent));
                }
            }

            return uri;
        } catch (error) {
            if (error instanceof Error && error.message === 'Template insertion cancelled') {
                return undefined;
            }
            vscode.window.showErrorMessage(`Failed to create file from template: ${error}`);
            return undefined;
        }
    }

    private getExtensionForFormat(format: TemplateFormat): string {
        switch (format) {
            case 'org':
                return '.org';
            case 'markdown':
                return '.md';
            case 'latex':
                return '.tex';
        }
    }

    /**
     * Create a new template from selected text
     */
    public async createTemplateFromSelection(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }

        const selection = editor.selection;
        if (selection.isEmpty) {
            vscode.window.showErrorMessage('No text selected');
            return;
        }

        const selectedText = editor.document.getText(selection);

        // Get template name
        const name = await vscode.window.showInputBox({
            prompt: 'Enter template name',
            placeHolder: 'my-template',
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return 'Template name cannot be empty';
                }
                if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
                    return 'Template name can only contain letters, numbers, hyphens, and underscores';
                }
                return null;
            },
        });

        if (!name) {
            return;
        }

        // Get description
        const description = await vscode.window.showInputBox({
            prompt: 'Enter template description (optional)',
            placeHolder: 'A brief description of this template',
        });

        // Determine format from current file
        const ext = path.extname(editor.document.fileName);
        const format = this.getFormatFromExtension(ext);

        // Build template content with metadata
        const templateContent = this.buildTemplateFile(name, description || '', format, selectedText);

        // Ensure templates directory exists
        await this.ensureTemplatesDirectory();

        // Save template
        const templatePath = path.join(this.config.directory, format, `${name}${ext || '.template'}`);
        await fs.promises.writeFile(templatePath, templateContent, 'utf-8');

        vscode.window.showInformationMessage(`Template "${name}" saved to ${templatePath}`);

        // Reload templates
        this.loadUserTemplates();
    }

    private buildTemplateFile(name: string, description: string, format: TemplateFormat, content: string): string {
        const header: string[] = [];

        switch (format) {
            case 'org':
                header.push(`#+NAME: ${name}`);
                if (description) {
                    header.push(`#+DESCRIPTION: ${description}`);
                }
                header.push(`#+CATEGORY: User Templates`);
                header.push('');
                break;
            case 'markdown':
                header.push(`<!-- NAME: ${name} -->`);
                if (description) {
                    header.push(`<!-- DESCRIPTION: ${description} -->`);
                }
                header.push(`<!-- CATEGORY: User Templates -->`);
                header.push('');
                break;
            case 'latex':
                header.push(`% NAME: ${name}`);
                if (description) {
                    header.push(`% DESCRIPTION: ${description}`);
                }
                header.push(`% CATEGORY: User Templates`);
                header.push('');
                break;
        }

        return header.join('\n') + content;
    }

    /**
     * Open the templates directory in the file explorer
     */
    public async openTemplatesDirectory(): Promise<void> {
        await this.ensureTemplatesDirectory();
        const uri = vscode.Uri.file(this.config.directory);
        await vscode.commands.executeCommand('revealFileInOS', uri);
    }

    /**
     * Open templates directory in VS Code
     */
    public async openTemplatesInEditor(): Promise<void> {
        await this.ensureTemplatesDirectory();
        const uri = vscode.Uri.file(this.config.directory);
        await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
    }

    /**
     * Get built-in templates
     */
    private getBuiltInTemplates(): Template[] {
        return [
            // Org-mode templates
            {
                id: 'org:article',
                name: 'Article',
                description: 'Basic org-mode article with title, author, and sections',
                format: 'org',
                category: 'Documents',
                builtIn: true,
                defaultFilename: 'article',
                content: `#+TITLE: \${1:Article Title}
#+AUTHOR: {{author}}
#+DATE: {{date}}
#+OPTIONS: toc:t num:t

* Introduction
\${2:Introduction text here...}

* \${3:Section 1}
\${4:Content...}

* \${5:Section 2}
\${6:Content...}

* Conclusion
\${7:Conclusion text here...}

$0`,
            },
            {
                id: 'org:research-notes',
                name: 'Research Notes',
                description: 'Template for research notes with problem, approach, and results',
                format: 'org',
                category: 'Research',
                builtIn: true,
                defaultFilename: 'research-notes',
                content: `#+TITLE: \${1:Research Topic}
#+AUTHOR: {{author}}
#+DATE: {{date}}
#+FILETAGS: :research:

* Problem Statement
\${2:Describe the problem you are investigating...}

* Background
\${3:Relevant background information and prior work...}

* Approach
\${4:Your approach to solving the problem...}

* Experiments
** Experiment 1: \${5:Name}
- Setup: \${6:Describe setup}
- Results: \${7:Results}

* Results
\${8:Summary of results...}

* Discussion
\${9:Discussion of findings...}

* References
\${10:Add references here...}

$0`,
            },
            {
                id: 'org:meeting-notes',
                name: 'Meeting Notes',
                description: 'Template for meeting notes with attendees, agenda, and action items',
                format: 'org',
                category: 'Meetings',
                builtIn: true,
                defaultFilename: 'meeting-{{date}}',
                content: `#+TITLE: Meeting: \${1:Meeting Topic}
#+DATE: {{date}} {{time}}
#+FILETAGS: :meeting:

* Attendees
- \${2:Name 1}
- \${3:Name 2}

* Agenda
1. \${4:Agenda item 1}
2. \${5:Agenda item 2}

* Discussion
** \${4:Agenda item 1}
\${6:Notes...}

** \${5:Agenda item 2}
\${7:Notes...}

* Action Items
- [ ] \${8:Action item} (\${9:Assignee})

* Next Meeting
\${10:Date and time for next meeting}

$0`,
            },
            {
                id: 'org:project',
                name: 'Project Plan',
                description: 'Project planning template with goals, milestones, and tasks',
                format: 'org',
                category: 'Projects',
                builtIn: true,
                defaultFilename: 'project-plan',
                content: `#+TITLE: \${1:Project Name}
#+AUTHOR: {{author}}
#+DATE: {{date}}
#+FILETAGS: :project:

* Overview
\${2:Brief project description...}

* Goals
- \${3:Goal 1}
- \${4:Goal 2}

* Milestones
** TODO Milestone 1: \${5:Name}
DEADLINE: \${6:<{{date}}>}
- [ ] \${7:Task 1}
- [ ] \${8:Task 2}

** TODO Milestone 2: \${9:Name}
- [ ] \${10:Task}

* Resources
- \${11:Resource 1}

* Risks
| Risk | Likelihood | Impact | Mitigation |
|------+------------+--------+------------|
| \${12:Risk} | \${13:High/Med/Low} | \${14:High/Med/Low} | \${15:Plan} |

* Notes
$0`,
            },
            {
                id: 'org:literature-review',
                name: 'Literature Review',
                description: 'Template for reviewing a paper or article',
                format: 'org',
                category: 'Research',
                builtIn: true,
                defaultFilename: 'review',
                content: `#+TITLE: Review: \${1:Paper Title}
#+AUTHOR: {{author}}
#+DATE: {{date}}
#+FILETAGS: :review:literature:

* Bibliographic Information
- Title: \${1:Paper Title}
- Authors: \${2:Authors}
- Year: \${3:Year}
- Journal/Conference: \${4:Venue}
- DOI: \${5:DOI}

* Summary
\${6:Brief summary of the paper...}

* Key Contributions
1. \${7:Contribution 1}
2. \${8:Contribution 2}

* Methodology
\${9:Description of methods used...}

* Results
\${10:Key results...}

* Strengths
- \${11:Strength 1}

* Weaknesses
- \${12:Weakness 1}

* Relevance to My Work
\${13:How this paper relates to your research...}

* Notes
$0`,
            },
            {
                id: 'org:src-block',
                name: 'Source Block',
                description: 'Code block with language and options',
                format: 'org',
                category: 'Code',
                builtIn: true,
                content: `#+BEGIN_SRC \${1:python} :\${2:results output}
\${3:# Your code here}
$0
#+END_SRC`,
            },

            // Markdown templates
            {
                id: 'md:readme',
                name: 'README',
                description: 'Standard README template for projects',
                format: 'markdown',
                category: 'Documentation',
                builtIn: true,
                defaultFilename: 'README',
                content: `# \${1:Project Name}

\${2:Brief description of your project}

## Installation

\`\`\`bash
\${3:npm install your-package}
\`\`\`

## Usage

\`\`\`\${4:javascript}
\${5:// Example code}
\`\`\`

## Features

- \${6:Feature 1}
- \${7:Feature 2}

## Contributing

\${8:Contribution guidelines...}

## License

\${9:MIT}

$0`,
            },
            {
                id: 'md:blog-post',
                name: 'Blog Post',
                description: 'Blog post template with frontmatter',
                format: 'markdown',
                category: 'Writing',
                builtIn: true,
                defaultFilename: '{{date}}-blog-post',
                content: `---
title: "\${1:Post Title}"
date: {{timestamp}}
author: {{author}}
tags: [\${2:tag1, tag2}]
draft: true
---

# \${1:Post Title}

\${3:Introduction paragraph that hooks the reader...}

## \${4:Section 1}

\${5:Content...}

## \${6:Section 2}

\${7:Content...}

## Conclusion

\${8:Wrap up your post...}

$0`,
            },
            {
                id: 'md:technical-doc',
                name: 'Technical Documentation',
                description: 'Template for technical documentation',
                format: 'markdown',
                category: 'Documentation',
                builtIn: true,
                defaultFilename: 'documentation',
                content: `# \${1:Document Title}

> \${2:Brief description of what this document covers}

## Overview

\${3:High-level overview...}

## Prerequisites

- \${4:Prerequisite 1}
- \${5:Prerequisite 2}

## Getting Started

### Step 1: \${6:First Step}

\${7:Instructions...}

\`\`\`bash
\${8:# Example command}
\`\`\`

### Step 2: \${9:Second Step}

\${10:Instructions...}

## Configuration

| Option | Description | Default |
|--------|-------------|---------|
| \${11:option} | \${12:description} | \${13:default} |

## Troubleshooting

### \${14:Common Issue}

\${15:Solution...}

## Related Documentation

- [\${16:Related Doc}](\${17:link})

$0`,
            },

            // LaTeX templates
            {
                id: 'latex:article',
                name: 'Article',
                description: 'LaTeX article with standard preamble',
                format: 'latex',
                category: 'Documents',
                builtIn: true,
                defaultFilename: 'article',
                content: `\\documentclass[12pt]{article}

\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage{hyperref}

\\title{\${1:Article Title}}
\\author{\${2:{{author}}}}
\\date{\${3:{{date}}}}

\\begin{document}

\\maketitle

\\begin{abstract}
\${4:Abstract text here...}
\\end{abstract}

\\section{Introduction}
\${5:Introduction text...}

\\section{\${6:Section Title}}
\${7:Content...}

\\section{Conclusion}
\${8:Conclusion text...}

\\bibliographystyle{plain}
\\bibliography{\${9:references}}

\\end{document}
$0`,
            },
            {
                id: 'latex:beamer',
                name: 'Beamer Presentation',
                description: 'LaTeX Beamer presentation template',
                format: 'latex',
                category: 'Presentations',
                builtIn: true,
                defaultFilename: 'presentation',
                content: `\\documentclass{beamer}

\\usetheme{\${1:Madrid}}
\\usecolortheme{\${2:default}}

\\title{\${3:Presentation Title}}
\\subtitle{\${4:Subtitle}}
\\author{\${5:{{author}}}}
\\institute{\${6:Institution}}
\\date{\${7:{{date}}}}

\\begin{document}

\\begin{frame}
\\titlepage
\\end{frame}

\\begin{frame}{Outline}
\\tableofcontents
\\end{frame}

\\section{Introduction}

\\begin{frame}{\${8:Frame Title}}
\\begin{itemize}
    \\item \${9:Point 1}
    \\item \${10:Point 2}
\\end{itemize}
\\end{frame}

\\section{\${11:Section 2}}

\\begin{frame}{\${12:Frame Title}}
\${13:Content...}
\\end{frame}

\\section{Conclusion}

\\begin{frame}{Conclusion}
\\begin{itemize}
    \\item \${14:Summary point}
\\end{itemize}
\\end{frame}

\\begin{frame}
\\centering
\\Huge{Thank You!}
\\end{frame}

\\end{document}
$0`,
            },
            {
                id: 'latex:letter',
                name: 'Letter',
                description: 'Formal letter template',
                format: 'latex',
                category: 'Documents',
                builtIn: true,
                defaultFilename: 'letter',
                content: `\\documentclass{letter}

\\usepackage[utf8]{inputenc}
\\usepackage[margin=1in]{geometry}

\\signature{\${1:{{author}}}}
\\address{\${2:Your Address \\\\ City, State ZIP}}

\\begin{document}

\\begin{letter}{\${3:Recipient Name} \\\\ \${4:Recipient Address} \\\\ \${5:City, State ZIP}}

\\opening{Dear \${6:Recipient},}

\${7:Body of the letter...}

\${8:Additional paragraphs...}

\\closing{Sincerely,}

\\end{letter}

\\end{document}
$0`,
            },
            {
                id: 'latex:equation',
                name: 'Equation Environment',
                description: 'Numbered equation',
                format: 'latex',
                category: 'Math',
                builtIn: true,
                content: `\\begin{equation}
    \${1:expression}
    \\label{eq:\${2:label}}
\\end{equation}
$0`,
            },
            {
                id: 'latex:figure',
                name: 'Figure',
                description: 'Figure environment with caption',
                format: 'latex',
                category: 'Floats',
                builtIn: true,
                content: `\\begin{figure}[\${1:htbp}]
    \\centering
    \\includegraphics[width=\${2:0.8}\\textwidth]{\${3:image}}
    \\caption{\${4:Caption text}}
    \\label{fig:\${5:label}}
\\end{figure}
$0`,
            },
            {
                id: 'latex:table',
                name: 'Table',
                description: 'Table environment with caption',
                format: 'latex',
                category: 'Floats',
                builtIn: true,
                content: `\\begin{table}[\${1:htbp}]
    \\centering
    \\caption{\${2:Caption text}}
    \\label{tab:\${3:label}}
    \\begin{tabular}{\${4:lcc}}
        \\hline
        \${5:Header 1} & \${6:Header 2} & \${7:Header 3} \\\\
        \\hline
        \${8:Data 1} & \${9:Data 2} & \${10:Data 3} \\\\
        \\hline
    \\end{tabular}
\\end{table}
$0`,
            },
        ];
    }

    public dispose(): void {
        this.fileWatcher?.dispose();
    }
}
