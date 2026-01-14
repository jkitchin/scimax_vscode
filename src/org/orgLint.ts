/**
 * Org-mode syntax linter
 * Based on Emacs org-lint.el
 */

import * as vscode from 'vscode';
import {
    OrgDocumentNode,
    OrgElement,
    OrgObject,
    HeadlineElement,
    SrcBlockElement,
    KeywordElement,
    NodePropertyElement,
    FootnoteDefinitionElement,
    FootnoteReferenceObject,
    LinkObject,
    TimestampObject,
    PlanningElement,
    SourcePosition,
} from '../parser/orgElementTypes';
import { parseOrg } from '../parser/orgParserUnified';

// =============================================================================
// Types
// =============================================================================

export interface LintIssue {
    range: vscode.Range;
    message: string;
    severity: vscode.DiagnosticSeverity;
    code: string;
}

export interface OrgLintChecker {
    id: string;
    name: string;
    description: string;
    check(doc: OrgDocumentNode, text: string, lines: string[]): LintIssue[];
}

// =============================================================================
// Utilities
// =============================================================================

function positionToRange(pos: SourcePosition | undefined, fallbackLine: number = 0): vscode.Range {
    if (pos) {
        return new vscode.Range(
            pos.start.line,
            pos.start.column,
            pos.end.line,
            pos.end.column
        );
    }
    return new vscode.Range(fallbackLine, 0, fallbackLine, 0);
}

function lineRange(line: number, startCol: number = 0, endCol?: number): vscode.Range {
    return new vscode.Range(line, startCol, line, endCol ?? startCol + 100);
}

/**
 * Visit all nodes in the document tree
 */
function visitNodes(
    doc: OrgDocumentNode,
    visitor: (node: OrgElement | OrgObject, parent?: OrgElement) => void
): void {
    function visitElement(element: OrgElement, parent?: OrgElement): void {
        visitor(element, parent);

        if (element.children) {
            for (const child of element.children) {
                if ('type' in child) {
                    if (isElement(child)) {
                        visitElement(child as OrgElement, element);
                    } else {
                        visitObject(child as OrgObject, element);
                    }
                }
            }
        }

        // Special handling for headline children
        if (element.type === 'headline') {
            const headline = element as HeadlineElement;
            if (headline.section) {
                visitElement(headline.section, headline);
            }
            if (headline.planning) {
                visitElement(headline.planning, headline);
            }
            for (const child of headline.children) {
                visitElement(child, headline);
            }
        }
    }

    function visitObject(obj: OrgObject, parent?: OrgElement): void {
        visitor(obj, parent);
        if (obj.children) {
            for (const child of obj.children) {
                visitObject(child, parent);
            }
        }
    }

    // Visit document section
    if (doc.section) {
        visitElement(doc.section);
    }

    // Visit headlines
    for (const headline of doc.children) {
        visitElement(headline);
    }
}

function isElement(node: OrgElement | OrgObject): node is OrgElement {
    const elementTypes = [
        'headline', 'section', 'plain-list', 'item', 'property-drawer', 'drawer',
        'center-block', 'quote-block', 'special-block', 'footnote-definition',
        'babel-call', 'clock', 'comment', 'comment-block', 'diary-sexp',
        'example-block', 'export-block', 'fixed-width', 'horizontal-rule',
        'keyword', 'latex-environment', 'node-property', 'paragraph',
        'planning', 'src-block', 'table', 'table-row', 'verse-block'
    ];
    return elementTypes.includes(node.type);
}

// =============================================================================
// Checkers: Phase 1 (High Value)
// =============================================================================

/**
 * Check for duplicate CUSTOM_ID properties
 */
const duplicateCustomId: OrgLintChecker = {
    id: 'duplicate-custom-id',
    name: 'Duplicate CUSTOM_ID',
    description: 'Reports duplicate CUSTOM_ID properties',
    check(doc: OrgDocumentNode): LintIssue[] {
        const issues: LintIssue[] = [];
        const customIds = new Map<string, { pos: SourcePosition | undefined; line: number }[]>();

        visitNodes(doc, (node) => {
            if (node.type === 'headline') {
                const headline = node as HeadlineElement;
                if (headline.properties.customId) {
                    const id = headline.properties.customId;
                    const existing = customIds.get(id) || [];
                    existing.push({
                        pos: headline.position,
                        line: headline.properties.lineNumber - 1
                    });
                    customIds.set(id, existing);
                }
            }
        });

        for (const [id, locations] of customIds) {
            if (locations.length > 1) {
                for (const loc of locations.slice(1)) {
                    issues.push({
                        range: positionToRange(loc.pos, loc.line),
                        message: `Duplicate CUSTOM_ID: "${id}"`,
                        severity: vscode.DiagnosticSeverity.Warning,
                        code: 'duplicate-custom-id'
                    });
                }
            }
        }

        return issues;
    }
};

/**
 * Check for duplicate NAME values
 */
const duplicateName: OrgLintChecker = {
    id: 'duplicate-name',
    name: 'Duplicate NAME',
    description: 'Reports duplicate NAME values',
    check(doc: OrgDocumentNode, text: string, lines: string[]): LintIssue[] {
        const issues: LintIssue[] = [];
        const names = new Map<string, number[]>();

        // Scan for #+NAME: lines
        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(/^#\+NAME:\s*(.+)$/i);
            if (match) {
                const name = match[1].trim();
                const existing = names.get(name) || [];
                existing.push(i);
                names.set(name, existing);
            }
        }

        for (const [name, lineNumbers] of names) {
            if (lineNumbers.length > 1) {
                for (const line of lineNumbers.slice(1)) {
                    issues.push({
                        range: lineRange(line),
                        message: `Duplicate NAME: "${name}"`,
                        severity: vscode.DiagnosticSeverity.Warning,
                        code: 'duplicate-name'
                    });
                }
            }
        }

        return issues;
    }
};

/**
 * Check for source blocks without language specification
 */
const missingLanguageInSrcBlock: OrgLintChecker = {
    id: 'missing-language-in-src-block',
    name: 'Missing Language',
    description: 'Reports source blocks without language specification',
    check(doc: OrgDocumentNode): LintIssue[] {
        const issues: LintIssue[] = [];

        visitNodes(doc, (node) => {
            if (node.type === 'src-block') {
                const srcBlock = node as SrcBlockElement;
                if (!srcBlock.properties.language || srcBlock.properties.language.trim() === '') {
                    issues.push({
                        range: positionToRange(srcBlock.position, srcBlock.properties.lineNumber - 1),
                        message: 'Source block missing language specification',
                        severity: vscode.DiagnosticSeverity.Warning,
                        code: 'missing-language-in-src-block'
                    });
                }
            }
        });

        return issues;
    }
};

/**
 * Check for unclosed or malformed blocks
 */
const invalidBlock: OrgLintChecker = {
    id: 'invalid-block',
    name: 'Invalid Block',
    description: 'Reports unclosed or malformed blocks',
    check(doc: OrgDocumentNode, text: string, lines: string[]): LintIssue[] {
        const issues: LintIssue[] = [];
        const blockStack: { type: string; line: number }[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Match #+BEGIN_xxx
            const beginMatch = line.match(/^#\+BEGIN_(\w+)/i);
            if (beginMatch) {
                blockStack.push({ type: beginMatch[1].toLowerCase(), line: i });
                continue;
            }

            // Match #+END_xxx
            const endMatch = line.match(/^#\+END_(\w+)/i);
            if (endMatch) {
                const endType = endMatch[1].toLowerCase();
                if (blockStack.length === 0) {
                    issues.push({
                        range: lineRange(i),
                        message: `#+END_${endType.toUpperCase()} without matching #+BEGIN`,
                        severity: vscode.DiagnosticSeverity.Error,
                        code: 'invalid-block'
                    });
                } else {
                    const top = blockStack.pop()!;
                    if (top.type !== endType) {
                        issues.push({
                            range: lineRange(i),
                            message: `Block type mismatch: expected #+END_${top.type.toUpperCase()}, found #+END_${endType.toUpperCase()}`,
                            severity: vscode.DiagnosticSeverity.Error,
                            code: 'invalid-block'
                        });
                    }
                }
            }
        }

        // Report unclosed blocks
        for (const block of blockStack) {
            issues.push({
                range: lineRange(block.line),
                message: `Unclosed block: #+BEGIN_${block.type.toUpperCase()} without #+END`,
                severity: vscode.DiagnosticSeverity.Error,
                code: 'invalid-block'
            });
        }

        return issues;
    }
};

/**
 * Check for unclosed drawers
 */
const incompleteDrawer: OrgLintChecker = {
    id: 'incomplete-drawer',
    name: 'Incomplete Drawer',
    description: 'Reports unclosed drawers',
    check(doc: OrgDocumentNode, text: string, lines: string[]): LintIssue[] {
        const issues: LintIssue[] = [];
        let drawerStart: { name: string; line: number } | null = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Drawer start: :NAME: (but not :END:)
            const drawerMatch = line.match(/^:([A-Za-z_][A-Za-z0-9_-]*):$/);
            if (drawerMatch && drawerMatch[1].toUpperCase() !== 'END') {
                if (drawerStart) {
                    // Previous drawer not closed
                    issues.push({
                        range: lineRange(drawerStart.line),
                        message: `Unclosed drawer: :${drawerStart.name}: without :END:`,
                        severity: vscode.DiagnosticSeverity.Error,
                        code: 'incomplete-drawer'
                    });
                }
                drawerStart = { name: drawerMatch[1], line: i };
                continue;
            }

            // Drawer end
            if (line === ':END:') {
                drawerStart = null;
                continue;
            }

            // Headlines reset drawer state
            if (line.match(/^\*+ /)) {
                if (drawerStart) {
                    issues.push({
                        range: lineRange(drawerStart.line),
                        message: `Unclosed drawer: :${drawerStart.name}: without :END:`,
                        severity: vscode.DiagnosticSeverity.Error,
                        code: 'incomplete-drawer'
                    });
                    drawerStart = null;
                }
            }
        }

        // Check for unclosed drawer at end of file
        if (drawerStart) {
            issues.push({
                range: lineRange(drawerStart.line),
                message: `Unclosed drawer: :${drawerStart.name}: without :END:`,
                severity: vscode.DiagnosticSeverity.Error,
                code: 'incomplete-drawer'
            });
        }

        return issues;
    }
};

/**
 * Check for broken internal links
 */
const brokenLink: OrgLintChecker = {
    id: 'broken-link',
    name: 'Broken Link',
    description: 'Reports links to non-existent internal targets',
    check(doc: OrgDocumentNode): LintIssue[] {
        const issues: LintIssue[] = [];

        // Collect all targets (CUSTOM_ID, NAME, dedicated targets, headlines)
        const targets = new Set<string>();
        const headlineTitles = new Set<string>();

        visitNodes(doc, (node) => {
            if (node.type === 'headline') {
                const headline = node as HeadlineElement;
                if (headline.properties.customId) {
                    targets.add('#' + headline.properties.customId);
                }
                if (headline.properties.id) {
                    targets.add(headline.properties.id);
                }
                // Add headline text as fuzzy target
                headlineTitles.add(headline.properties.rawValue.toLowerCase().trim());
            }
            if (node.type === 'keyword') {
                const kw = node as KeywordElement;
                if (kw.properties.key.toUpperCase() === 'NAME') {
                    targets.add(kw.properties.value.trim());
                }
            }
            if (node.type === 'target') {
                const target = node as OrgObject;
                if ('properties' in target && 'value' in (target as any).properties) {
                    targets.add((target as any).properties.value);
                }
            }
        });

        // Check all internal links
        visitNodes(doc, (node) => {
            if (node.type === 'link') {
                const link = node as LinkObject;
                const linkType = link.properties.linkType;
                const path = link.properties.path;

                // Check custom-id links
                if (linkType === 'custom-id') {
                    if (!targets.has('#' + path)) {
                        issues.push({
                            range: positionToRange(link.position),
                            message: `Broken link: CUSTOM_ID "#${path}" not found`,
                            severity: vscode.DiagnosticSeverity.Warning,
                            code: 'broken-link'
                        });
                    }
                }

                // Check ID links
                if (linkType === 'id') {
                    if (!targets.has(path)) {
                        issues.push({
                            range: positionToRange(link.position),
                            message: `Broken link: ID "${path}" not found in document`,
                            severity: vscode.DiagnosticSeverity.Warning,
                            code: 'broken-link'
                        });
                    }
                }

                // Check fuzzy links (internal references)
                if (linkType === 'fuzzy') {
                    const lowerPath = path.toLowerCase().trim();
                    if (!targets.has(path) && !headlineTitles.has(lowerPath)) {
                        issues.push({
                            range: positionToRange(link.position),
                            message: `Broken link: target "${path}" not found`,
                            severity: vscode.DiagnosticSeverity.Warning,
                            code: 'broken-link'
                        });
                    }
                }
            }
        });

        return issues;
    }
};

/**
 * Check for undefined footnote references
 */
const undefinedFootnoteReference: OrgLintChecker = {
    id: 'undefined-footnote-reference',
    name: 'Undefined Footnote',
    description: 'Reports footnote references without definitions',
    check(doc: OrgDocumentNode): LintIssue[] {
        const issues: LintIssue[] = [];

        // Collect all footnote definitions
        const definitions = new Set<string>();
        visitNodes(doc, (node) => {
            if (node.type === 'footnote-definition') {
                const def = node as FootnoteDefinitionElement;
                definitions.add(def.properties.label);
            }
        });

        // Check all footnote references
        visitNodes(doc, (node) => {
            if (node.type === 'footnote-reference') {
                const ref = node as FootnoteReferenceObject;
                if (ref.properties.label && ref.properties.referenceType === 'standard') {
                    if (!definitions.has(ref.properties.label)) {
                        issues.push({
                            range: positionToRange(ref.position),
                            message: `Undefined footnote: [fn:${ref.properties.label}]`,
                            severity: vscode.DiagnosticSeverity.Warning,
                            code: 'undefined-footnote-reference'
                        });
                    }
                }
            }
        });

        return issues;
    }
};

/**
 * Check for unreferenced footnote definitions
 */
const unreferencedFootnoteDefinition: OrgLintChecker = {
    id: 'unreferenced-footnote-definition',
    name: 'Unreferenced Footnote',
    description: 'Reports footnote definitions that are never referenced',
    check(doc: OrgDocumentNode): LintIssue[] {
        const issues: LintIssue[] = [];

        // Collect all footnote references
        const references = new Set<string>();
        visitNodes(doc, (node) => {
            if (node.type === 'footnote-reference') {
                const ref = node as FootnoteReferenceObject;
                if (ref.properties.label) {
                    references.add(ref.properties.label);
                }
            }
        });

        // Check all footnote definitions
        visitNodes(doc, (node) => {
            if (node.type === 'footnote-definition') {
                const def = node as FootnoteDefinitionElement;
                if (!references.has(def.properties.label)) {
                    issues.push({
                        range: positionToRange(def.position),
                        message: `Unreferenced footnote definition: [fn:${def.properties.label}]`,
                        severity: vscode.DiagnosticSeverity.Information,
                        code: 'unreferenced-footnote-definition'
                    });
                }
            }
        });

        return issues;
    }
};

/**
 * Check for malformed timestamps
 */
const timestampSyntax: OrgLintChecker = {
    id: 'timestamp-syntax',
    name: 'Timestamp Syntax',
    description: 'Reports malformed timestamps',
    check(doc: OrgDocumentNode, text: string, lines: string[]): LintIssue[] {
        const issues: LintIssue[] = [];

        // Regex for potential timestamps that might be malformed
        const timestampPattern = /[<\[][\d-]+.*?[>\]]/g;
        const validTimestamp = /^[<\[](\d{4})-(\d{2})-(\d{2})( [A-Za-z]{2,3})?( \d{1,2}:\d{2}(-\d{1,2}:\d{2})?)?( \+?\d+[hdwmy])?( -\d+[hdwmy])?[>\]]$/;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            let match;

            while ((match = timestampPattern.exec(line)) !== null) {
                const ts = match[0];

                // Check if it looks like a timestamp but is malformed
                if (ts.match(/^[<\[]\d/) && !ts.match(validTimestamp)) {
                    // Validate date components
                    const dateMatch = ts.match(/[<\[](\d{4})-(\d{2})-(\d{2})/);
                    if (dateMatch) {
                        const year = parseInt(dateMatch[1]);
                        const month = parseInt(dateMatch[2]);
                        const day = parseInt(dateMatch[3]);

                        if (month < 1 || month > 12) {
                            issues.push({
                                range: lineRange(i, match.index, match.index + ts.length),
                                message: `Invalid month in timestamp: ${month}`,
                                severity: vscode.DiagnosticSeverity.Error,
                                code: 'timestamp-syntax'
                            });
                        } else if (day < 1 || day > 31) {
                            issues.push({
                                range: lineRange(i, match.index, match.index + ts.length),
                                message: `Invalid day in timestamp: ${day}`,
                                severity: vscode.DiagnosticSeverity.Error,
                                code: 'timestamp-syntax'
                            });
                        }
                    }
                }
            }
        }

        return issues;
    }
};

/**
 * Check for clock issues using existing clock consistency checker
 */
const clockIssues: OrgLintChecker = {
    id: 'clock-issues',
    name: 'Clock Issues',
    description: 'Reports clock entry problems',
    check(doc: OrgDocumentNode, text: string, lines: string[]): LintIssue[] {
        const issues: LintIssue[] = [];

        // Find CLOCK lines and check for obvious issues
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('CLOCK:')) {
                // Check for running clocks
                if (!line.includes('--') && !line.includes('=>')) {
                    // This is a running clock, not necessarily an issue but worth noting
                    // Only flag if it's been open too long (we can't tell from syntax alone)
                }

                // Check for malformed clock lines
                const clockMatch = line.match(/^CLOCK:\s*\[([^\]]+)\](\s*--\s*\[([^\]]+)\])?/);
                if (!clockMatch) {
                    issues.push({
                        range: lineRange(i),
                        message: 'Malformed CLOCK entry',
                        severity: vscode.DiagnosticSeverity.Warning,
                        code: 'clock-issues'
                    });
                } else if (clockMatch[3]) {
                    // Has end time - check if end is before start
                    const startStr = clockMatch[1];
                    const endStr = clockMatch[3];

                    try {
                        const startDate = parseClockDate(startStr);
                        const endDate = parseClockDate(endStr);
                        if (startDate && endDate && endDate < startDate) {
                            issues.push({
                                range: lineRange(i),
                                message: 'Clock end time is before start time',
                                severity: vscode.DiagnosticSeverity.Error,
                                code: 'clock-issues'
                            });
                        }
                    } catch {
                        // Parsing failed, skip
                    }
                }
            }
        }

        return issues;
    }
};

function parseClockDate(str: string): Date | null {
    // Parse: 2024-01-15 Mon 10:30
    const match = str.match(/(\d{4})-(\d{2})-(\d{2})\s+\w+\s+(\d{1,2}):(\d{2})/);
    if (match) {
        return new Date(
            parseInt(match[1]),
            parseInt(match[2]) - 1,
            parseInt(match[3]),
            parseInt(match[4]),
            parseInt(match[5])
        );
    }
    return null;
}

// =============================================================================
// Checkers: Phase 2 (Structure Checks)
// =============================================================================

/**
 * Check for orphaned affiliated keywords
 */
const orphanedAffiliatedKeywords: OrgLintChecker = {
    id: 'orphaned-affiliated-keywords',
    name: 'Orphaned Keywords',
    description: 'Reports #+NAME/#+CAPTION without following element',
    check(doc: OrgDocumentNode, text: string, lines: string[]): LintIssue[] {
        const issues: LintIssue[] = [];
        const affiliatedPattern = /^#\+(NAME|CAPTION|ATTR_\w+|HEADER|RESULTS):/i;

        for (let i = 0; i < lines.length; i++) {
            if (affiliatedPattern.test(lines[i])) {
                // Look at next non-blank, non-affiliated line
                let j = i + 1;
                while (j < lines.length && (lines[j].trim() === '' || affiliatedPattern.test(lines[j]))) {
                    j++;
                }

                // Check if next line is an element that can have affiliated keywords
                if (j >= lines.length) {
                    issues.push({
                        range: lineRange(i),
                        message: 'Affiliated keyword at end of file without following element',
                        severity: vscode.DiagnosticSeverity.Warning,
                        code: 'orphaned-affiliated-keywords'
                    });
                } else {
                    const nextLine = lines[j];
                    // Affiliated keywords should precede: src blocks, tables, images, etc.
                    const validFollowers = [
                        /^#\+BEGIN_/i,
                        /^\|/,  // Table
                        /^\[\[.*\]\]/,  // Link (could be image)
                        /^:/,  // Drawer
                    ];

                    if (nextLine.match(/^\*+ /) || nextLine.match(/^#\+/i) && !nextLine.match(/^#\+BEGIN_/i)) {
                        issues.push({
                            range: lineRange(i),
                            message: 'Affiliated keyword followed by headline or keyword instead of content element',
                            severity: vscode.DiagnosticSeverity.Warning,
                            code: 'orphaned-affiliated-keywords'
                        });
                    }
                }
            }
        }

        return issues;
    }
};

/**
 * Check for wrong header arguments in source blocks
 */
const wrongHeaderArgument: OrgLintChecker = {
    id: 'wrong-header-argument',
    name: 'Wrong Header Argument',
    description: 'Reports invalid babel header arguments',
    check(doc: OrgDocumentNode): LintIssue[] {
        const issues: LintIssue[] = [];

        const validHeaders = new Set([
            'results', 'exports', 'tangle', 'dir', 'file', 'file-desc', 'file-ext',
            'var', 'cache', 'noweb', 'noweb-ref', 'noweb-sep', 'session', 'eval',
            'hlines', 'colnames', 'rownames', 'sep', 'output-dir', 'mkdirp',
            'comments', 'shebang', 'padline', 'post', 'prologue', 'epilogue',
            'wrap', 'cmdline', 'stdin', 'async', 'output'
        ]);

        visitNodes(doc, (node) => {
            if (node.type === 'src-block') {
                const srcBlock = node as SrcBlockElement;
                const headers = srcBlock.properties.headers || {};

                for (const key of Object.keys(headers)) {
                    if (!validHeaders.has(key.toLowerCase())) {
                        issues.push({
                            range: positionToRange(srcBlock.position, srcBlock.properties.lineNumber - 1),
                            message: `Unknown header argument: :${key}`,
                            severity: vscode.DiagnosticSeverity.Warning,
                            code: 'wrong-header-argument'
                        });
                    }
                }
            }
        });

        return issues;
    }
};

/**
 * Check for inactive timestamps in SCHEDULED/DEADLINE
 */
const planningInactive: OrgLintChecker = {
    id: 'planning-inactive',
    name: 'Inactive Planning',
    description: 'Reports inactive timestamps in SCHEDULED/DEADLINE',
    check(doc: OrgDocumentNode, text: string, lines: string[]): LintIssue[] {
        const issues: LintIssue[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Check for SCHEDULED with inactive timestamp
            const scheduledInactive = line.match(/SCHEDULED:\s*\[([^\]]+)\]/);
            if (scheduledInactive) {
                issues.push({
                    range: lineRange(i),
                    message: 'Inactive timestamp in SCHEDULED will not appear in agenda',
                    severity: vscode.DiagnosticSeverity.Warning,
                    code: 'planning-inactive'
                });
            }

            // Check for DEADLINE with inactive timestamp
            const deadlineInactive = line.match(/DEADLINE:\s*\[([^\]]+)\]/);
            if (deadlineInactive) {
                issues.push({
                    range: lineRange(i),
                    message: 'Inactive timestamp in DEADLINE will not appear in agenda',
                    severity: vscode.DiagnosticSeverity.Warning,
                    code: 'planning-inactive'
                });
            }
        }

        return issues;
    }
};

/**
 * Check for heading level skips
 */
const headingLevelSkip: OrgLintChecker = {
    id: 'heading-level-skip',
    name: 'Heading Level Skip',
    description: 'Reports jumping from level N to level N+2 or higher',
    check(doc: OrgDocumentNode): LintIssue[] {
        const issues: LintIssue[] = [];
        let lastLevel = 0;

        function checkHeadline(headline: HeadlineElement): void {
            const level = headline.properties.level;

            if (lastLevel > 0 && level > lastLevel + 1) {
                issues.push({
                    range: positionToRange(headline.position, headline.properties.lineNumber - 1),
                    message: `Heading level skip: jumped from level ${lastLevel} to level ${level}`,
                    severity: vscode.DiagnosticSeverity.Warning,
                    code: 'heading-level-skip'
                });
            }

            lastLevel = level;

            // Check children
            for (const child of headline.children) {
                checkHeadline(child);
            }

            // Reset level after children (for sibling handling)
            lastLevel = level;
        }

        for (const headline of doc.children) {
            lastLevel = 0;
            checkHeadline(headline);
        }

        return issues;
    }
};

// =============================================================================
// Checker Registry
// =============================================================================

export const ALL_CHECKERS: OrgLintChecker[] = [
    // Phase 1
    duplicateCustomId,
    duplicateName,
    missingLanguageInSrcBlock,
    invalidBlock,
    incompleteDrawer,
    brokenLink,
    undefinedFootnoteReference,
    unreferencedFootnoteDefinition,
    timestampSyntax,
    clockIssues,
    // Phase 2
    orphanedAffiliatedKeywords,
    wrongHeaderArgument,
    planningInactive,
    headingLevelSkip,
];

// =============================================================================
// Main Lint Function
// =============================================================================

export interface LintOptions {
    disabledCheckers?: string[];
}

export function lintOrgDocument(
    text: string,
    options: LintOptions = {}
): LintIssue[] {
    const disabledSet = new Set(options.disabledCheckers || []);
    const lines = text.split('\n');

    // Parse the document
    const doc = parseOrg(text, { addPositions: true });

    // Run all enabled checkers
    const issues: LintIssue[] = [];

    for (const checker of ALL_CHECKERS) {
        if (!disabledSet.has(checker.id)) {
            try {
                const checkerIssues = checker.check(doc, text, lines);
                issues.push(...checkerIssues);
            } catch (error) {
                console.error(`Error in checker ${checker.id}:`, error);
            }
        }
    }

    // Sort by line number
    issues.sort((a, b) => a.range.start.line - b.range.start.line);

    return issues;
}

/**
 * Get list of all available checker IDs
 */
export function getCheckerIds(): string[] {
    return ALL_CHECKERS.map(c => c.id);
}

/**
 * Get checker descriptions for documentation
 */
export function getCheckerDescriptions(): Array<{ id: string; name: string; description: string }> {
    return ALL_CHECKERS.map(c => ({
        id: c.id,
        name: c.name,
        description: c.description
    }));
}
