import * as vscode from 'vscode';

/**
 * Represents a parsed markdown task
 */
export interface MarkdownTask {
    // Location
    file: string;
    line: number;

    // Content
    text: string;           // Full line text
    title: string;          // Task title (without metadata)

    // State
    completed: boolean;

    // Metadata
    due?: Date;             // @due(YYYY-MM-DD)
    scheduled?: Date;       // @scheduled(YYYY-MM-DD)
    closed?: Date;          // @closed(YYYY-MM-DD)
    priority?: string;      // @priority(A), @priority(B), @priority(C)
    tags: string[];         // #tag1 #tag2
    project?: string;       // @project(name)

    // Raw metadata for display
    rawMetadata: Map<string, string>;
}

/**
 * Parse a single line for task metadata
 */
export function parseTaskLine(line: string, filePath: string, lineNumber: number): MarkdownTask | null {
    // Match checkbox pattern: - [ ] or - [x] or * [ ] etc.
    const checkboxPattern = /^(\s*[-*+]\s*)\[([ xX])\]\s*(.*)$/;
    const match = line.match(checkboxPattern);

    if (!match) {
        return null;
    }

    const completed = match[2].toLowerCase() === 'x';
    const content = match[3];

    // Extract metadata
    const task: MarkdownTask = {
        file: filePath,
        line: lineNumber,
        text: line,
        title: content,
        completed,
        tags: [],
        rawMetadata: new Map()
    };

    // Parse @key(value) patterns
    const metadataPattern = /@(\w+)\(([^)]+)\)/g;
    let metaMatch;
    while ((metaMatch = metadataPattern.exec(content)) !== null) {
        const key = metaMatch[1].toLowerCase();
        const value = metaMatch[2];

        task.rawMetadata.set(key, value);

        switch (key) {
            case 'due':
                task.due = parseDate(value);
                break;
            case 'scheduled':
                task.scheduled = parseDate(value);
                break;
            case 'closed':
                task.closed = parseDate(value);
                break;
            case 'priority':
                task.priority = value.toUpperCase();
                break;
            case 'project':
                task.project = value;
                break;
        }

        // Remove metadata from title
        task.title = task.title.replace(metaMatch[0], '').trim();
    }

    // Parse #tags
    const tagPattern = /#([\w-]+)/g;
    let tagMatch;
    while ((tagMatch = tagPattern.exec(content)) !== null) {
        task.tags.push(tagMatch[1]);
        // Remove tag from title
        task.title = task.title.replace(tagMatch[0], '').trim();
    }

    // Clean up extra whitespace in title
    task.title = task.title.replace(/\s+/g, ' ').trim();

    return task;
}

/**
 * Parse a date string (supports various formats)
 */
function parseDate(dateStr: string): Date | undefined {
    // Try YYYY-MM-DD
    const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
        return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
    }

    // Try MM/DD/YYYY
    const usMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (usMatch) {
        return new Date(parseInt(usMatch[3]), parseInt(usMatch[1]) - 1, parseInt(usMatch[2]));
    }

    // Try natural language (today, tomorrow, next week, etc.)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const lower = dateStr.toLowerCase();
    if (lower === 'today') {
        return today;
    }
    if (lower === 'tomorrow') {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow;
    }
    if (lower === 'next week') {
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);
        return nextWeek;
    }

    // Try parsing with Date constructor as fallback
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
        return parsed;
    }

    return undefined;
}

/**
 * Parse all tasks from a document
 */
export function parseTasksFromDocument(document: vscode.TextDocument): MarkdownTask[] {
    const tasks: MarkdownTask[] = [];

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;
        const task = parseTaskLine(line, document.uri.fsPath, i);
        if (task) {
            tasks.push(task);
        }
    }

    return tasks;
}

/**
 * Parse all tasks from a file path
 */
export async function parseTasksFromFile(filePath: string): Promise<MarkdownTask[]> {
    try {
        const uri = vscode.Uri.file(filePath);
        const document = await vscode.workspace.openTextDocument(uri);
        return parseTasksFromDocument(document);
    } catch {
        return [];
    }
}

/**
 * Format a date for display
 */
export function formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Format a date relative to today
 */
export function formatRelativeDate(date: Date): string {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const target = new Date(date);
    target.setHours(0, 0, 0, 0);

    const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';
    if (diffDays > 0 && diffDays <= 7) return `In ${diffDays} days`;
    if (diffDays < 0 && diffDays >= -7) return `${-diffDays} days ago`;

    return formatDate(date);
}

/**
 * Check if a task is overdue
 */
export function isOverdue(task: MarkdownTask): boolean {
    if (task.completed) return false;
    if (!task.due) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const due = new Date(task.due);
    due.setHours(0, 0, 0, 0);

    return due < today;
}

/**
 * Check if a task is due today
 */
export function isDueToday(task: MarkdownTask): boolean {
    if (task.completed) return false;
    if (!task.due) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const due = new Date(task.due);
    due.setHours(0, 0, 0, 0);

    return due.getTime() === today.getTime();
}

/**
 * Check if a task is scheduled for today
 */
export function isScheduledToday(task: MarkdownTask): boolean {
    if (task.completed) return false;
    if (!task.scheduled) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const scheduled = new Date(task.scheduled);
    scheduled.setHours(0, 0, 0, 0);

    return scheduled.getTime() === today.getTime();
}

/**
 * Sort tasks by priority and due date
 */
export function sortTasks(tasks: MarkdownTask[]): MarkdownTask[] {
    return [...tasks].sort((a, b) => {
        // Completed tasks go last
        if (a.completed !== b.completed) {
            return a.completed ? 1 : -1;
        }

        // Sort by priority (A > B > C > none)
        const priorityOrder: Record<string, number> = { 'A': 0, 'B': 1, 'C': 2 };
        const aPriority = a.priority ? priorityOrder[a.priority] ?? 3 : 3;
        const bPriority = b.priority ? priorityOrder[b.priority] ?? 3 : 3;
        if (aPriority !== bPriority) {
            return aPriority - bPriority;
        }

        // Sort by due date (earlier first, no date last)
        if (a.due && b.due) {
            return a.due.getTime() - b.due.getTime();
        }
        if (a.due) return -1;
        if (b.due) return 1;

        return 0;
    });
}

/**
 * Insert metadata at cursor position
 */
export function insertMetadata(key: string, value: string): string {
    return `@${key}(${value})`;
}

/**
 * Insert a tag
 */
export function insertTag(tag: string): string {
    return `#${tag}`;
}
