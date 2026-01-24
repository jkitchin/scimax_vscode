/**
 * Org-mode capture system
 * Provides templates and infrastructure for quickly capturing notes, tasks, etc.
 */

import { format } from 'date-fns';
import { DAY_NAMES_SHORT } from '../utils/dateConstants';

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Capture template definition
 */
export interface CaptureTemplate {
    /** Unique key for the template (e.g., 't' for todo) */
    key: string;
    /** Display name */
    name: string;
    /** Description */
    description?: string;
    /** Target file path */
    file: string;
    /** Target location in file */
    target?: CaptureTarget;
    /** Template content */
    template: string;
    /** Template type */
    type?: 'entry' | 'item' | 'checkitem' | 'table-line' | 'plain';
    /** Properties to add */
    properties?: Record<string, string>;
    /** Tags to add */
    tags?: string[];
    /** Whether to add timestamp */
    timestamp?: boolean;
    /** Whether to prompt for confirmation before saving */
    immediate?: boolean;
    /** Hook to run before capture */
    beforeCapture?: (context: CaptureContext) => void | Promise<void>;
    /** Hook to run after capture */
    afterCapture?: (context: CaptureContext) => void | Promise<void>;
}

/**
 * Target location for captured content
 */
export interface CaptureTarget {
    /** Target type */
    type: 'file' | 'headline' | 'file+headline' | 'file+olp' | 'file+datetree' | 'clock' | 'function';
    /** Headline text to match (for headline types) */
    headline?: string;
    /** Outline path (for olp types) */
    outlinePath?: string[];
    /** Whether to prepend (vs append) */
    prepend?: boolean;
    /** Custom function for target resolution */
    function?: (context: CaptureContext) => CaptureLocation;
}

/**
 * Resolved location for insertion
 */
export interface CaptureLocation {
    /** File path */
    file: string;
    /** Line number to insert at */
    line: number;
    /** Column number */
    column?: number;
    /** Level of headline to create */
    level?: number;
}

/**
 * Context passed to capture templates and hooks
 */
export interface CaptureContext {
    /** Captured text from selection or clipboard */
    initialContent?: string;
    /** Source file where capture was initiated */
    sourceFile?: string;
    /** Source line number */
    sourceLine?: number;
    /** Current date/time */
    date: Date;
    /** User-provided input values */
    inputs: Record<string, string>;
    /** Resolved template content */
    content?: string;
    /** Target location */
    location?: CaptureLocation;
    /** Additional context data */
    data?: Record<string, unknown>;
}

/**
 * Template expansion token
 */
export interface TemplateToken {
    /** Token type */
    type: 'text' | 'placeholder' | 'timestamp' | 'link' | 'property' | 'tag';
    /** Raw token text */
    raw: string;
    /** Token value/name */
    value: string;
    /** Default value for placeholders */
    default?: string;
    /** Whether placeholder is required */
    required?: boolean;
}

// =============================================================================
// Template Parser
// =============================================================================

/**
 * Template placeholder patterns
 *
 * %^{prompt} - Interactive prompt
 * %^{prompt|default} - Prompt with default
 * %? - Point position after capture
 * %i - Initial content (selection/clipboard)
 * %a - Annotation (link to source)
 * %A - Annotation with description
 * %l - Literal link to source
 * %c - Current kill ring head (clipboard)
 * %x - Content from X clipboard
 * %t - Timestamp
 * %T - Active timestamp with time
 * %u - Inactive timestamp
 * %U - Inactive timestamp with time
 * %^t - Prompt for timestamp
 * %^T - Prompt for active timestamp with time
 * %^u - Prompt for inactive timestamp
 * %^U - Prompt for inactive timestamp with time
 * %^g - Prompt for tags
 * %^G - Prompt for tags with inherited tags
 * %^{prop}p - Prompt for property value
 * %k - Template key
 * %K - Template key description
 * %n - User name
 * %f - Source file path
 * %F - Source file full path
 * %(expression) - Evaluated expression
 * %\n - Literal newline
 */
const TEMPLATE_PATTERN = /%(\^?\{[^}]+\}|[?iatTuUcxklKnfFA%]|\([^)]+\)|\\n)/g;

/**
 * Parse template string into tokens
 */
export function parseTemplate(template: string): TemplateToken[] {
    const tokens: TemplateToken[] = [];
    let lastIndex = 0;
    let match;

    TEMPLATE_PATTERN.lastIndex = 0;

    while ((match = TEMPLATE_PATTERN.exec(template)) !== null) {
        // Add text before match
        if (match.index > lastIndex) {
            tokens.push({
                type: 'text',
                raw: template.slice(lastIndex, match.index),
                value: template.slice(lastIndex, match.index),
            });
        }

        const token = match[1];
        const raw = match[0];

        if (token.startsWith('^{')) {
            // Interactive prompt
            const inner = token.slice(2, -1);
            const [prompt, defaultVal] = inner.split('|');
            tokens.push({
                type: 'placeholder',
                raw,
                value: prompt,
                default: defaultVal,
                required: true,
            });
        } else if (token.startsWith('{')) {
            // Non-interactive placeholder
            const inner = token.slice(1, -1);
            tokens.push({
                type: 'placeholder',
                raw,
                value: inner,
                required: false,
            });
        } else if (token.startsWith('(')) {
            // Expression
            const expr = token.slice(1, -1);
            tokens.push({
                type: 'placeholder',
                raw,
                value: expr,
                required: false,
            });
        } else {
            // Simple token
            tokens.push({
                type: getTokenType(token),
                raw,
                value: token,
            });
        }

        lastIndex = match.index + raw.length;
    }

    // Add remaining text
    if (lastIndex < template.length) {
        tokens.push({
            type: 'text',
            raw: template.slice(lastIndex),
            value: template.slice(lastIndex),
        });
    }

    return tokens;
}

function getTokenType(token: string): TemplateToken['type'] {
    switch (token) {
        case 't':
        case 'T':
        case 'u':
        case 'U':
        case '^t':
        case '^T':
        case '^u':
        case '^U':
            return 'timestamp';
        case 'a':
        case 'A':
        case 'l':
            return 'link';
        case '^g':
        case '^G':
            return 'tag';
        default:
            return 'placeholder';
    }
}

// =============================================================================
// Template Expansion
// =============================================================================

/**
 * Expand template with context
 */
export function expandTemplate(
    template: string | CaptureTemplate,
    context: CaptureContext
): string {
    const templateStr = typeof template === 'string' ? template : template.template;
    const tokens = parseTemplate(templateStr);

    return tokens.map(token => expandToken(token, context)).join('');
}

/**
 * Expand a single token
 */
function expandToken(token: TemplateToken, context: CaptureContext): string {
    if (token.type === 'text') {
        return token.value;
    }

    switch (token.value) {
        case '?':
            return ''; // Cursor position - handled separately
        case 'i':
            return context.initialContent || '';
        case 'a':
        case 'A':
            return formatAnnotation(context, token.value === 'A');
        case 'l':
            return formatLink(context);
        case 'c':
        case 'x':
            return context.initialContent || '';
        case 't':
            return formatTimestamp(context.date, false, false);
        case 'T':
            return formatTimestamp(context.date, true, false);
        case 'u':
            return formatTimestamp(context.date, false, true);
        case 'U':
            return formatTimestamp(context.date, true, true);
        case 'k':
            return context.data?.templateKey as string || '';
        case 'K':
            return context.data?.templateName as string || '';
        case 'n':
            return process.env.USER || process.env.USERNAME || 'user';
        case 'f':
            return context.sourceFile?.split('/').pop() || '';
        case 'F':
            return context.sourceFile || '';
        case '%':
            return '%';
        case '\\n':
            return '\n';
        default:
            // Check for placeholder inputs
            if (context.inputs[token.value]) {
                return context.inputs[token.value];
            }
            // Check for expression evaluation
            if (token.raw.startsWith('%(')) {
                return evaluateExpression(token.value, context);
            }
            return token.default || '';
    }
}

function formatTimestamp(date: Date, withTime: boolean, inactive: boolean): string {
    const open = inactive ? '[' : '<';
    const close = inactive ? ']' : '>';

    const dateStr = format(date, 'yyyy-MM-dd');
    const dayName = DAY_NAMES_SHORT[date.getDay()];

    if (withTime) {
        const timeStr = format(date, 'HH:mm');
        return `${open}${dateStr} ${dayName} ${timeStr}${close}`;
    }

    return `${open}${dateStr} ${dayName}${close}`;
}

function formatAnnotation(context: CaptureContext, withDescription: boolean): string {
    if (!context.sourceFile) {
        return '';
    }

    const fileName = context.sourceFile.split('/').pop() || context.sourceFile;
    const lineNum = context.sourceLine || 1;

    if (withDescription) {
        return `[[file:${context.sourceFile}::${lineNum}][${fileName}:${lineNum}]]`;
    }

    return `[[file:${context.sourceFile}::${lineNum}]]`;
}

function formatLink(context: CaptureContext): string {
    if (!context.sourceFile) {
        return '';
    }

    const lineNum = context.sourceLine || 1;
    return `file:${context.sourceFile}::${lineNum}`;
}

function evaluateExpression(expr: string, context: CaptureContext): string {
    // Safe expression evaluation for common patterns
    try {
        // Date formatting
        if (expr.startsWith('format-time-string')) {
            const formatMatch = expr.match(/"([^"]+)"/);
            if (formatMatch) {
                return formatDateString(formatMatch[1], context.date);
            }
        }

        // Simple expressions
        if (expr === 'current-time') {
            return context.date.toISOString();
        }

        // Return empty for unknown expressions
        return '';
    } catch {
        return '';
    }
}

function formatDateString(formatStr: string, date: Date): string {
    // Convert Emacs format codes to date-fns
    return formatStr
        .replace('%Y', format(date, 'yyyy'))
        .replace('%m', format(date, 'MM'))
        .replace('%d', format(date, 'dd'))
        .replace('%H', format(date, 'HH'))
        .replace('%M', format(date, 'mm'))
        .replace('%S', format(date, 'ss'))
        .replace('%A', format(date, 'EEEE'))
        .replace('%a', format(date, 'EEE'))
        .replace('%B', format(date, 'MMMM'))
        .replace('%b', format(date, 'MMM'));
}

// =============================================================================
// Capture Template Registry
// =============================================================================

/**
 * Registry for capture templates
 */
class CaptureTemplateRegistry {
    private templates: Map<string, CaptureTemplate> = new Map();

    /**
     * Register a capture template
     */
    register(template: CaptureTemplate): void {
        this.templates.set(template.key, template);
    }

    /**
     * Unregister a template
     */
    unregister(key: string): boolean {
        return this.templates.delete(key);
    }

    /**
     * Get a template by key
     */
    get(key: string): CaptureTemplate | undefined {
        return this.templates.get(key);
    }

    /**
     * Get all templates
     */
    getAll(): CaptureTemplate[] {
        return Array.from(this.templates.values());
    }

    /**
     * Clear all templates
     */
    clear(): void {
        this.templates.clear();
    }
}

// Global template registry
export const captureTemplateRegistry = new CaptureTemplateRegistry();

// =============================================================================
// Built-in Templates
// =============================================================================

/**
 * Basic TODO template
 */
export const todoTemplate: CaptureTemplate = {
    key: 't',
    name: 'Todo',
    description: 'Create a new TODO item',
    file: 'todo.org',
    type: 'entry',
    template: '* TODO %^{Task}\n%?',
    tags: [],
};

/**
 * Note template
 */
export const noteTemplate: CaptureTemplate = {
    key: 'n',
    name: 'Note',
    description: 'Create a quick note',
    file: 'notes.org',
    type: 'entry',
    template: '* %^{Title}\n%U\n\n%?',
    timestamp: true,
};

/**
 * Journal entry template
 */
export const journalTemplate: CaptureTemplate = {
    key: 'j',
    name: 'Journal',
    description: 'Create a journal entry',
    file: 'journal.org',
    type: 'entry',
    target: {
        type: 'file+datetree',
    },
    template: '* %U %^{Entry title}\n%?',
};

/**
 * Meeting notes template
 */
export const meetingTemplate: CaptureTemplate = {
    key: 'm',
    name: 'Meeting',
    description: 'Capture meeting notes',
    file: 'meetings.org',
    type: 'entry',
    template: `* Meeting: %^{Subject}
%T
** Attendees
%^{Attendees}
** Agenda
%?
** Notes

** Action Items
`,
};

/**
 * Code snippet template
 */
export const snippetTemplate: CaptureTemplate = {
    key: 's',
    name: 'Code Snippet',
    description: 'Capture a code snippet',
    file: 'snippets.org',
    type: 'entry',
    template: `* %^{Description}
:PROPERTIES:
:CREATED: %U
:SOURCE: %a
:END:

#+BEGIN_SRC %^{Language|python}
%i%?
#+END_SRC
`,
};

/**
 * Bookmark template
 */
export const bookmarkTemplate: CaptureTemplate = {
    key: 'b',
    name: 'Bookmark',
    description: 'Save a bookmark',
    file: 'bookmarks.org',
    type: 'entry',
    template: '* [[%^{URL}][%^{Title}]]\n%U\n%?',
};

/**
 * Register built-in templates
 */
export function registerBuiltinTemplates(): void {
    captureTemplateRegistry.register(todoTemplate);
    captureTemplateRegistry.register(noteTemplate);
    captureTemplateRegistry.register(journalTemplate);
    captureTemplateRegistry.register(meetingTemplate);
    captureTemplateRegistry.register(snippetTemplate);
    captureTemplateRegistry.register(bookmarkTemplate);
}

// Auto-register built-in templates
registerBuiltinTemplates();

// =============================================================================
// Capture Functions
// =============================================================================

/**
 * Get required prompts from a template
 */
export function getRequiredPrompts(template: CaptureTemplate): string[] {
    const tokens = parseTemplate(template.template);
    const prompts: string[] = [];

    for (const token of tokens) {
        if (token.type === 'placeholder' && token.required) {
            prompts.push(token.value);
        }
    }

    return prompts;
}

/**
 * Create a capture context
 */
export function createCaptureContext(
    template: CaptureTemplate,
    options: {
        initialContent?: string;
        sourceFile?: string;
        sourceLine?: number;
        inputs?: Record<string, string>;
    } = {}
): CaptureContext {
    return {
        initialContent: options.initialContent,
        sourceFile: options.sourceFile,
        sourceLine: options.sourceLine,
        date: new Date(),
        inputs: options.inputs || {},
        data: {
            templateKey: template.key,
            templateName: template.name,
        },
    };
}

/**
 * Execute capture with template
 */
export async function capture(
    template: CaptureTemplate,
    context: CaptureContext
): Promise<string> {
    // Run before hook
    if (template.beforeCapture) {
        await template.beforeCapture(context);
    }

    // Expand template
    const content = expandTemplate(template, context);
    context.content = content;

    // Add properties if specified
    let finalContent = content;
    if (template.properties && Object.keys(template.properties).length > 0) {
        const propLines = Object.entries(template.properties)
            .map(([key, value]) => `:${key}: ${expandTemplate(value, context)}`)
            .join('\n');

        // Insert properties after first headline
        const headlineMatch = finalContent.match(/^(\*+ .+)$/m);
        if (headlineMatch) {
            const insertPos = headlineMatch.index! + headlineMatch[0].length;
            finalContent = finalContent.slice(0, insertPos) +
                '\n:PROPERTIES:\n' + propLines + '\n:END:' +
                finalContent.slice(insertPos);
        }
    }

    // Add tags if specified
    if (template.tags && template.tags.length > 0) {
        const tagStr = ':' + template.tags.join(':') + ':';
        const headlineMatch = finalContent.match(/^(\*+ .+?)(\s*)$/m);
        if (headlineMatch) {
            finalContent = finalContent.replace(
                headlineMatch[0],
                headlineMatch[1] + ' ' + tagStr
            );
        }
    }

    // Run after hook
    if (template.afterCapture) {
        await template.afterCapture(context);
    }

    return finalContent;
}

/**
 * Generate datetree path for a date
 */
export function generateDatetreePath(date: Date): string[] {
    const year = format(date, 'yyyy');
    const month = format(date, 'yyyy-MM MMMM');
    const day = format(date, 'yyyy-MM-dd EEEE');

    return [year, month, day];
}

// =============================================================================
// Exports
// =============================================================================

export {
    CaptureTemplateRegistry,
};
