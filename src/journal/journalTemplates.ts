/**
 * Journal Templates - shared between VS Code extension and CLI
 *
 * No vscode dependency so this module can be used from the CLI.
 */

export interface TemplateContext {
    date: string;       // YYYY-MM-DD
    year: string;
    month: string;      // zero-padded
    day: string;        // zero-padded
    weekday: string;    // full name
    monthName: string;  // full name
    timestamp: string;  // ISO string
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Build template context from a Date
 */
export function buildTemplateContext(date: Date): TemplateContext {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();

    return {
        date: `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`,
        year: year.toString(),
        month: month.toString().padStart(2, '0'),
        day: day.toString().padStart(2, '0'),
        weekday: WEEKDAYS[date.getDay()],
        monthName: MONTHS[date.getMonth()],
        timestamp: new Date().toISOString(),
    };
}

/**
 * Render a template string by substituting {{placeholders}}
 */
export function renderTemplate(template: string, ctx: TemplateContext): string {
    return template
        .replace(/\{\{date\}\}/g, ctx.date)
        .replace(/\{\{year\}\}/g, ctx.year)
        .replace(/\{\{month\}\}/g, ctx.month)
        .replace(/\{\{day\}\}/g, ctx.day)
        .replace(/\{\{weekday\}\}/g, ctx.weekday)
        .replace(/\{\{monthName\}\}/g, ctx.monthName)
        .replace(/\{\{timestamp\}\}/g, ctx.timestamp);
}

/**
 * Built-in org-mode templates
 */
export const ORG_TEMPLATES: Record<string, string> = {
    'default': `#+TITLE: {{date}} - {{weekday}}

`,
    'minimal': `#+TITLE: {{date}}
#+DATE: {{date}}

* Notes
`,
    'research': `#+TITLE: Research Log - {{date}}
#+DATE: {{date}}

* Goals for Today
- [ ]

* Experiments

* Results

* Next Steps

* References
`,
    'meeting': `#+TITLE: Meeting Notes - {{date}}
#+DATE: {{date}}

* Attendees
-

* Agenda
1.

* Discussion

* Action Items
- [ ]

* Next Meeting
`,
    'standup': `#+TITLE: Standup - {{date}}
#+DATE: {{date}}

* Yesterday
-

* Today
-

* Blockers
-
`,
};

/**
 * Built-in markdown templates
 */
export const MARKDOWN_TEMPLATES: Record<string, string> = {
    'default': `# {{date}} - {{weekday}}

`,
    'minimal': `# {{date}}

## Notes
`,
    'research': `# Research Log - {{date}}

## Goals for Today
- [ ]

## Experiments

## Results

## Next Steps

## References
`,
    'meeting': `# Meeting Notes - {{date}}

## Attendees
-

## Agenda
1.

## Discussion

## Action Items
- [ ]

## Next Meeting
`,
    'standup': `# Standup - {{date}}

## Yesterday
-

## Today
-

## Blockers
-
`,
};

/**
 * Get built-in templates for a given format
 */
export function getBuiltInTemplates(format: string): Record<string, string> {
    return format === 'org' ? ORG_TEMPLATES : MARKDOWN_TEMPLATES;
}

/**
 * Resolve which template string to use.
 *
 * Priority:
 *   1. customTemplate setting (user-provided template string)
 *   2. Custom template file in journal/.scimax/templates/
 *   3. Built-in template by name
 */
export function resolveTemplate(options: {
    templateName: string;
    format: string;
    customTemplate?: string;
    customTemplateDir?: string;
}): string {
    const { templateName, format, customTemplate, customTemplateDir } = options;

    // 1. User-provided custom template string from settings
    if (customTemplate) {
        return customTemplate;
    }

    // 2. Custom template file (caller handles reading; this is for the built-in fallback)
    if (customTemplateDir) {
        // Caller should have checked the file and passed content via customTemplate
        // This path exists for documentation; actual file reading is done by the caller
    }

    // 3. Built-in template
    const templates = getBuiltInTemplates(format);
    return templates[templateName] || templates['default'];
}

/**
 * Render a journal entry for a given date
 */
export function renderJournalEntry(date: Date, options: {
    templateName: string;
    format: string;
    customTemplate?: string;
}): string {
    const template = resolveTemplate(options);
    const ctx = buildTemplateContext(date);
    return renderTemplate(template, ctx);
}
