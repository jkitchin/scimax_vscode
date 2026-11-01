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
            case 'deadline':
                // @deadline(...) is an alias for @due(...); an explicit @due wins
                if (!task.rawMetadata.has('due')) {
                    task.due = parseDate(value);
                }
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
    }

    task.tags = extractTags(content);
    task.title = stripTaskMetadata(content);

    return task;
}

// A #tag must start a line or follow whitespace and begin with a letter, so
// `#123` and URL fragments (`http://x.org/page#section`) are not tags.
const TAG_PATTERN = /(^|\s)#([A-Za-z][\w-]*)/g;

/**
 * Extract #tags from task/heading text
 */
export function extractTags(text: string): string[] {
    const tags: string[] = [];
    for (const m of text.matchAll(TAG_PATTERN)) {
        tags.push(m[2]);
    }
    return tags;
}

/**
 * Remove @key(value) metadata and #tags from text, collapsing whitespace
 */
export function stripTaskMetadata(text: string): string {
    return text
        .replace(/@\w+\([^)]+\)/g, ' ')
        .replace(TAG_PATTERN, '$1')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Set a date metadata tag (`@scheduled(...)`, `@due(...)`) on a markdown
 * heading or checkbox task line: an existing tag of the same kind is replaced
 * in place (for `due`, a legacy `@deadline(...)` too), otherwise the tag is
 * appended to the end of the line. Returns undefined when the line is neither
 * a heading nor a task.
 */
export function setDateTagOnLine(line: string, key: 'scheduled' | 'due', dateStr: string): string | undefined {
    if (!/^#{1,6}[ \t]/.test(line) && !/^\s*[-*+]\s*\[[ xX]\]/.test(line)) {
        return undefined;
    }
    const tag = `@${key}(${dateStr})`;
    const keys = key === 'due' ? 'due|deadline' : key;
    const existing = new RegExp(`([ \\t]*)@(?:${keys})\\([^)]*\\)`, 'g');
    if (existing.test(line)) {
        let first = true;
        return line
            .replace(existing, (_m, ws: string) => {
                if (first) { first = false; return ws + tag; }
                return '';
            })
            .replace(/[ \t]+$/, '');
    }
    const trimmed = line.replace(/[ \t]+$/, '');
    return `${trimmed} ${tag}`;
}

/**
 * Build a local date, rejecting out-of-range parts (no silent rollover:
 * 2026-02-30 is invalid rather than March 2).
 */
function makeValidDate(year: number, month: number, day: number): Date | undefined {
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
        return undefined;
    }
    return d;
}

/**
 * Parse a date string (supports various formats)
 */
export function parseDate(dateStr: string): Date | undefined {
    // Try YYYY-MM-DD
    const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
        return makeValidDate(parseInt(isoMatch[1]), parseInt(isoMatch[2]), parseInt(isoMatch[3]));
    }

    // Try MM/DD/YYYY
    const usMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (usMatch) {
        return makeValidDate(parseInt(usMatch[3]), parseInt(usMatch[1]), parseInt(usMatch[2]));
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
    // (rejecting rollover such as "Feb 30 2026" -> Mar 2, and other
    // numeric forms that look like dates but did not match above)
    if (/^\d+[-/]\d+[-/]\d+$/.test(dateStr.trim())) {
        return undefined;
    }
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
        const dayNumbers = (dateStr.match(/\b\d{1,2}\b/g) || []).map(n => parseInt(n));
        if (dayNumbers.length > 0 && !dayNumbers.includes(parsed.getDate())) {
            return undefined;
        }
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
 * Check if a task is overdue (past due, or scheduled in the past and not done)
 */
export function isOverdue(task: MarkdownTask): boolean {
    if (task.completed) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // An incomplete task whose due date OR scheduled date has passed is
    // overdue (scheduled-in-the-past tasks carry over, as in the org agenda).
    return [task.due, task.scheduled].some(date => {
        if (!date) return false;
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d < today;
    });
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
