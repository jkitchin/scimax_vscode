/**
 * Progress Logging for Repeating Tasks
 *
 * Implements org-mode style progress logging when repeating tasks cycle back to TODO.
 * Logs LAST_REPEAT property and state change entries when configured.
 */

import * as vscode from 'vscode';
import { createLogger } from '../utils/logger';

const log = createLogger('ProgressLogging');

// =============================================================================
// Types and Interfaces
// =============================================================================

export type LogRepeatSetting = 'false' | 'time' | 'note';

export interface LoggingConfig {
    logRepeat: LogRepeatSetting;
    logIntoDrawer: boolean | string;
}

export interface TextEdit {
    range: vscode.Range;
    newText: string;
}

// =============================================================================
// Timestamp Formatting
// =============================================================================

/**
 * Format an inactive timestamp in org-mode format
 * Example: [2026-01-23 Fri 07:31]
 */
export function formatInactiveTimestamp(date: Date = new Date()): string {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dayName = days[date.getDay()];
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `[${year}-${month}-${day} ${dayName} ${hours}:${minutes}]`;
}

/**
 * Format a state change log entry
 * Example: - State "DONE"       from "TODO"       [2026-01-23 Fri 07:31]
 * Each state is padded to 13 characters to match org-mode formatting
 */
export function formatStateChangeEntry(
    toState: string,
    fromState: string | undefined,
    timestamp?: Date,
    note?: string
): string {
    const ts = formatInactiveTimestamp(timestamp || new Date());
    // Pad states to 13 characters (includes quotes) to match org-mode
    const toStatePadded = `"${toState}"`.padEnd(13, ' ');
    const fromStatePadded = fromState ? `"${fromState}"`.padEnd(13, ' ') : '"undefined"   ';

    let entry = `- State ${toStatePadded}from ${fromStatePadded}${ts}`;
    if (note) {
        // Note goes on next line with proper indentation
        entry += ` \\\\\n  ${note}`;
    }
    return entry;
}

// =============================================================================
// STARTUP Keyword Parsing
// =============================================================================

/**
 * Parse #+STARTUP keywords for log repeat setting
 * Recognized keywords:
 * - nologrepeat -> 'false'
 * - logrepeat -> 'time'
 * - lognoterepeat -> 'note'
 * Last occurrence wins.
 */
export function parseStartupLogRepeat(document: vscode.TextDocument): LogRepeatSetting | undefined {
    let result: LogRepeatSetting | undefined;

    for (let i = 0; i < Math.min(document.lineCount, 100); i++) {
        const line = document.lineAt(i).text;
        const match = line.match(/^#\+STARTUP:\s+(.+)/i);
        if (match) {
            const keywords = match[1].toLowerCase().split(/\s+/);
            for (const keyword of keywords) {
                if (keyword === 'nologrepeat') {
                    result = 'false';
                } else if (keyword === 'logrepeat') {
                    result = 'time';
                } else if (keyword === 'lognoterepeat') {
                    result = 'note';
                }
            }
        }
    }

    return result;
}

/**
 * Parse #+STARTUP keywords for log drawer setting
 * Recognized keywords:
 * - logdrawer -> true (use :LOGBOOK:)
 * - nologdrawer -> false (use body text)
 */
export function parseStartupLogDrawer(document: vscode.TextDocument): boolean | undefined {
    let result: boolean | undefined;

    for (let i = 0; i < Math.min(document.lineCount, 100); i++) {
        const line = document.lineAt(i).text;
        const match = line.match(/^#\+STARTUP:\s+(.+)/i);
        if (match) {
            const keywords = match[1].toLowerCase().split(/\s+/);
            for (const keyword of keywords) {
                if (keyword === 'logdrawer') {
                    result = true;
                } else if (keyword === 'nologdrawer') {
                    result = false;
                }
            }
        }
    }

    return result;
}

// =============================================================================
// Heading Property Parsing
// =============================================================================

/**
 * Find the :PROPERTIES: drawer for a heading
 * Returns the line range of the drawer (start to end inclusive)
 */
export function findPropertiesDrawer(
    document: vscode.TextDocument,
    headingLine: number
): { startLine: number; endLine: number } | null {
    // Properties drawer must be on the line(s) immediately after heading
    // (possibly after SCHEDULED/DEADLINE lines)
    for (let i = headingLine + 1; i < Math.min(headingLine + 10, document.lineCount); i++) {
        const line = document.lineAt(i).text.trim();

        // Skip SCHEDULED/DEADLINE lines
        if (line.startsWith('SCHEDULED:') || line.startsWith('DEADLINE:') || line.startsWith('CLOSED:')) {
            continue;
        }

        // Check for :PROPERTIES: start
        if (line === ':PROPERTIES:') {
            // Find :END:
            for (let j = i + 1; j < Math.min(i + 100, document.lineCount); j++) {
                if (document.lineAt(j).text.trim() === ':END:') {
                    return { startLine: i, endLine: j };
                }
                // Stop if we hit a heading
                if (document.lineAt(j).text.match(/^\*+\s/)) {
                    return null;
                }
            }
            return null;
        }

        // If we hit a heading or any other content, no properties drawer
        if (line && !line.startsWith(':')) {
            return null;
        }
    }

    return null;
}

/**
 * Get a property value from a heading's properties drawer
 */
export function getPropertyValue(
    document: vscode.TextDocument,
    headingLine: number,
    propertyName: string
): string | undefined {
    const drawer = findPropertiesDrawer(document, headingLine);
    if (!drawer) {
        return undefined;
    }

    const propRegex = new RegExp(`:${propertyName}:\\s*(.*)`, 'i');
    for (let i = drawer.startLine + 1; i < drawer.endLine; i++) {
        const match = document.lineAt(i).text.match(propRegex);
        if (match) {
            return match[1].trim();
        }
    }

    return undefined;
}

/**
 * Get the :LOGGING: property for a heading
 */
export function getLoggingProperty(
    document: vscode.TextDocument,
    headingLine: number
): string | undefined {
    return getPropertyValue(document, headingLine, 'LOGGING');
}

/**
 * Parse the LOGGING property value
 * Recognized values:
 * - logrepeat -> 'time'
 * - lognoterepeat -> 'note'
 * - nologrepeat -> 'false'
 */
export function parseLoggingProperty(value: string): LogRepeatSetting | undefined {
    const lower = value.toLowerCase().trim();
    if (lower === 'logrepeat') {
        return 'time';
    } else if (lower === 'lognoterepeat') {
        return 'note';
    } else if (lower === 'nologrepeat' || lower === 'nil') {
        return 'false';
    }
    return undefined;
}

// =============================================================================
// Configuration Resolution
// =============================================================================

/**
 * Get global logging configuration from VS Code settings
 */
export function getGlobalLoggingConfig(): LoggingConfig {
    const config = vscode.workspace.getConfiguration('scimax.org');
    return {
        logRepeat: config.get<LogRepeatSetting>('logRepeat', 'false'),
        logIntoDrawer: config.get<boolean | string>('logIntoDrawer', false)
    };
}

/**
 * Resolve the effective logging configuration for a heading
 * Priority: Heading :LOGGING: property > File #+STARTUP > Global setting
 */
export function resolveLoggingConfig(
    document: vscode.TextDocument,
    headingLine: number
): LoggingConfig {
    // Start with global settings
    const config = getGlobalLoggingConfig();

    // Check file-level STARTUP
    const startupLogRepeat = parseStartupLogRepeat(document);
    if (startupLogRepeat !== undefined) {
        config.logRepeat = startupLogRepeat;
    }

    const startupLogDrawer = parseStartupLogDrawer(document);
    if (startupLogDrawer !== undefined) {
        config.logIntoDrawer = startupLogDrawer;
    }

    // Check heading-level LOGGING property (highest priority)
    const loggingProp = getLoggingProperty(document, headingLine);
    if (loggingProp) {
        const headingLogRepeat = parseLoggingProperty(loggingProp);
        if (headingLogRepeat !== undefined) {
            config.logRepeat = headingLogRepeat;
        }
    }

    return config;
}

// =============================================================================
// Drawer Finding and Creation
// =============================================================================

/**
 * Find a named drawer under a heading
 * Returns line range (start to end inclusive) or null
 */
export function findDrawer(
    document: vscode.TextDocument,
    headingLine: number,
    drawerName: string
): { startLine: number; endLine: number } | null {
    const drawerStart = `:${drawerName.toUpperCase()}:`;

    for (let i = headingLine + 1; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;

        // Stop at next heading
        if (line.match(/^\*+\s/)) {
            return null;
        }

        if (line.trim() === drawerStart) {
            // Find :END:
            for (let j = i + 1; j < document.lineCount; j++) {
                if (document.lineAt(j).text.trim() === ':END:') {
                    return { startLine: i, endLine: j };
                }
                // Stop if we hit a heading
                if (document.lineAt(j).text.match(/^\*+\s/)) {
                    return null;
                }
            }
            return null;
        }
    }

    return null;
}

/**
 * Find the LOGBOOK drawer
 */
export function findLogbookDrawer(
    document: vscode.TextDocument,
    headingLine: number
): { startLine: number; endLine: number } | null {
    return findDrawer(document, headingLine, 'LOGBOOK');
}

// =============================================================================
// Insertion Point Finding
// =============================================================================

/**
 * Find the line where DEADLINE/SCHEDULED are located (if any)
 * Returns the line number of the last planning line, or -1 if none
 */
export function findPlanningLinesEnd(
    document: vscode.TextDocument,
    headingLine: number
): number {
    let lastPlanningLine = -1;

    for (let i = headingLine + 1; i < Math.min(headingLine + 5, document.lineCount); i++) {
        const line = document.lineAt(i).text.trim();

        if (line.startsWith('SCHEDULED:') || line.startsWith('DEADLINE:') || line.startsWith('CLOSED:')) {
            lastPlanningLine = i;
        } else if (line && !line.startsWith(':')) {
            // Non-empty line that's not a drawer - stop looking
            break;
        } else if (line.startsWith(':PROPERTIES:') || line.startsWith(':LOGBOOK:')) {
            // Hit a drawer - stop looking for planning lines
            break;
        }
    }

    return lastPlanningLine;
}

/**
 * Find the insertion point for a new properties drawer
 * Should be right after DEADLINE/SCHEDULED lines or the heading itself
 */
export function findPropertiesInsertionPoint(
    document: vscode.TextDocument,
    headingLine: number
): number {
    const planningEnd = findPlanningLinesEnd(document, headingLine);
    return planningEnd >= 0 ? planningEnd + 1 : headingLine + 1;
}

/**
 * Find the insertion point for log entries
 * If using drawer: inside the drawer (after opening line)
 * Otherwise: after properties drawer (if any) or after planning lines
 */
export function findLogInsertionPoint(
    document: vscode.TextDocument,
    headingLine: number,
    logIntoDrawer: boolean | string
): { line: number; needsDrawer: boolean; drawerName: string | null } {
    if (logIntoDrawer) {
        const drawerName = typeof logIntoDrawer === 'string' ? logIntoDrawer : 'LOGBOOK';
        const drawer = findDrawer(document, headingLine, drawerName);

        if (drawer) {
            // Insert at top of drawer (after opening line)
            return { line: drawer.startLine + 1, needsDrawer: false, drawerName: null };
        } else {
            // Need to create drawer - find where to create it
            const propsDrawer = findPropertiesDrawer(document, headingLine);
            if (propsDrawer) {
                // Insert after properties drawer
                return { line: propsDrawer.endLine + 1, needsDrawer: true, drawerName };
            } else {
                // Insert after planning lines
                return { line: findPropertiesInsertionPoint(document, headingLine), needsDrawer: true, drawerName };
            }
        }
    } else {
        // Log into body - find position after all metadata
        const propsDrawer = findPropertiesDrawer(document, headingLine);
        if (propsDrawer) {
            // Check for existing LOGBOOK after properties
            const logbook = findLogbookDrawer(document, headingLine);
            if (logbook && logbook.startLine === propsDrawer.endLine + 1) {
                return { line: logbook.endLine + 1, needsDrawer: false, drawerName: null };
            }
            return { line: propsDrawer.endLine + 1, needsDrawer: false, drawerName: null };
        } else {
            const planningEnd = findPlanningLinesEnd(document, headingLine);
            return { line: planningEnd >= 0 ? planningEnd + 1 : headingLine + 1, needsDrawer: false, drawerName: null };
        }
    }
}

// =============================================================================
// Edit Building
// =============================================================================

/**
 * Build text edits to add or update LAST_REPEAT property
 * Returns an edit that either updates existing property or creates drawer if needed
 */
export function buildLastRepeatEdits(
    document: vscode.TextDocument,
    headingLine: number,
    timestamp?: Date
): TextEdit[] {
    const edits: TextEdit[] = [];
    const ts = formatInactiveTimestamp(timestamp || new Date());

    const drawer = findPropertiesDrawer(document, headingLine);

    if (drawer) {
        // Check if LAST_REPEAT already exists
        for (let i = drawer.startLine + 1; i < drawer.endLine; i++) {
            const line = document.lineAt(i);
            if (line.text.match(/:LAST_REPEAT:/i)) {
                // Replace existing line
                edits.push({
                    range: line.range,
                    newText: `:LAST_REPEAT: ${ts}`
                });
                return edits;
            }
        }

        // LAST_REPEAT doesn't exist - add it as first property
        const insertPos = new vscode.Position(drawer.startLine + 1, 0);
        edits.push({
            range: new vscode.Range(insertPos, insertPos),
            newText: `:LAST_REPEAT: ${ts}\n`
        });
    } else {
        // No properties drawer - create one
        const insertLine = findPropertiesInsertionPoint(document, headingLine);
        const insertPos = new vscode.Position(insertLine, 0);
        edits.push({
            range: new vscode.Range(insertPos, insertPos),
            newText: `:PROPERTIES:\n:LAST_REPEAT: ${ts}\n:END:\n`
        });
    }

    return edits;
}

/**
 * Build text edits to insert a state change log entry
 */
export function buildLogEntryEdits(
    document: vscode.TextDocument,
    headingLine: number,
    toState: string,
    fromState: string | undefined,
    logIntoDrawer: boolean | string,
    timestamp?: Date,
    note?: string
): TextEdit[] {
    const edits: TextEdit[] = [];
    const entry = formatStateChangeEntry(toState, fromState, timestamp, note);

    // Find where to insert - need to account for any edits we might have just made
    // to the properties drawer. Since buildLastRepeatEdits might have added a drawer,
    // we need to re-find the insertion point.
    const insertionInfo = findLogInsertionPoint(document, headingLine, logIntoDrawer);

    if (insertionInfo.needsDrawer && insertionInfo.drawerName) {
        // Need to create drawer with the entry
        const insertPos = new vscode.Position(insertionInfo.line, 0);
        edits.push({
            range: new vscode.Range(insertPos, insertPos),
            newText: `:${insertionInfo.drawerName.toUpperCase()}:\n${entry}\n:END:\n`
        });
    } else {
        // Insert entry directly
        const insertPos = new vscode.Position(insertionInfo.line, 0);
        edits.push({
            range: new vscode.Range(insertPos, insertPos),
            newText: `${entry}\n`
        });
    }

    return edits;
}

// =============================================================================
// Combined Edit Application
// =============================================================================

/**
 * Calculate adjusted edits when multiple edits affect the same region
 * This handles the case where buildLastRepeatEdits creates a new properties drawer
 * and buildLogEntryEdits needs to insert after it
 */
export function combineEditsForRepeatLogging(
    document: vscode.TextDocument,
    headingLine: number,
    toState: string,
    fromState: string | undefined,
    config: LoggingConfig,
    timestamp?: Date,
    note?: string
): TextEdit[] {
    const allEdits: TextEdit[] = [];
    const ts = timestamp || new Date();
    const entry = formatStateChangeEntry(toState, fromState, ts, note);

    // Find existing structures
    const existingPropsDrawer = findPropertiesDrawer(document, headingLine);
    const drawerName = config.logIntoDrawer
        ? (typeof config.logIntoDrawer === 'string' ? config.logIntoDrawer : 'LOGBOOK')
        : null;
    const existingLogDrawer = drawerName ? findDrawer(document, headingLine, drawerName) : null;

    log.debug(`Existing props drawer: ${existingPropsDrawer ? `lines ${existingPropsDrawer.startLine}-${existingPropsDrawer.endLine}` : 'none'}`);
    log.debug(`Existing log drawer (${drawerName}): ${existingLogDrawer ? `lines ${existingLogDrawer.startLine}-${existingLogDrawer.endLine}` : 'none'}`);

    const timestampStr = formatInactiveTimestamp(ts);

    // Handle LAST_REPEAT property
    if (existingPropsDrawer) {
        // Check if LAST_REPEAT already exists
        let foundLastRepeat = false;
        for (let i = existingPropsDrawer.startLine + 1; i < existingPropsDrawer.endLine; i++) {
            const line = document.lineAt(i);
            if (line.text.match(/:LAST_REPEAT:/i)) {
                // Replace existing line
                log.debug(`Replacing existing LAST_REPEAT at line ${i}`);
                allEdits.push({
                    range: line.range,
                    newText: `:LAST_REPEAT: ${timestampStr}`
                });
                foundLastRepeat = true;
                break;
            }
        }
        if (!foundLastRepeat) {
            // Add LAST_REPEAT as first property
            log.debug(`Adding LAST_REPEAT at line ${existingPropsDrawer.startLine + 1}`);
            const insertPos = new vscode.Position(existingPropsDrawer.startLine + 1, 0);
            allEdits.push({
                range: new vscode.Range(insertPos, insertPos),
                newText: `:LAST_REPEAT: ${timestampStr}\n`
            });
        }
    } else {
        // No properties drawer - create one at the insertion point
        const insertLine = findPropertiesInsertionPoint(document, headingLine);
        log.debug(`Creating new PROPERTIES drawer at line ${insertLine}`);
        const insertPos = new vscode.Position(insertLine, 0);
        allEdits.push({
            range: new vscode.Range(insertPos, insertPos),
            newText: `:PROPERTIES:\n:LAST_REPEAT: ${timestampStr}\n:END:\n`
        });
    }

    // Handle log entry
    if (config.logIntoDrawer && drawerName) {
        if (existingLogDrawer) {
            // Insert at top of existing log drawer
            let insertLine = existingLogDrawer.startLine + 1;
            // Adjust if we're adding a new property to existing props drawer (adds 1 line)
            if (existingPropsDrawer && !allEdits.some(e => e.newText.includes(':PROPERTIES:'))) {
                // Check if we're inserting a new LAST_REPEAT line (not replacing)
                const addingNewProp = allEdits.some(e =>
                    e.range.start.line === existingPropsDrawer.startLine + 1 &&
                    e.range.start.character === 0 &&
                    e.range.end.line === e.range.start.line &&
                    e.range.end.character === 0
                );
                if (addingNewProp && existingLogDrawer.startLine > existingPropsDrawer.startLine) {
                    insertLine += 1;
                }
            }
            log.debug(`Inserting log entry into existing ${drawerName} at line ${insertLine}`);
            const insertPos = new vscode.Position(insertLine, 0);
            allEdits.push({
                range: new vscode.Range(insertPos, insertPos),
                newText: `${entry}\n`
            });
        } else {
            // Need to create log drawer
            // Insert at same position as props drawer if we created one, otherwise after props/planning
            let insertLine: number;
            if (existingPropsDrawer) {
                insertLine = existingPropsDrawer.endLine + 1;
                // Adjust if we added a new LAST_REPEAT property
                const addingNewProp = allEdits.some(e =>
                    e.range.start.line === existingPropsDrawer.startLine + 1 &&
                    e.range.isEmpty
                );
                if (addingNewProp) {
                    insertLine += 1;
                }
            } else {
                // We're creating props drawer, so log drawer goes at same position
                // VS Code will stack them: props drawer first, then log drawer
                insertLine = findPropertiesInsertionPoint(document, headingLine);
            }
            log.debug(`Creating new ${drawerName} drawer at line ${insertLine}`);
            const insertPos = new vscode.Position(insertLine, 0);
            allEdits.push({
                range: new vscode.Range(insertPos, insertPos),
                newText: `:${drawerName}:\n${entry}\n:END:\n`
            });
        }
    } else {
        // Logging into body text (not a drawer)
        let insertLine: number;
        if (existingPropsDrawer) {
            // After existing properties drawer
            insertLine = existingPropsDrawer.endLine + 1;
            // Adjust if we added a new LAST_REPEAT property
            const addingNewProp = allEdits.some(e =>
                e.range.start.line === existingPropsDrawer.startLine + 1 &&
                e.range.isEmpty
            );
            if (addingNewProp) {
                insertLine += 1;
            }
            // Also check for existing LOGBOOK that we should skip over
            const existingLogbook = findDrawer(document, headingLine, 'LOGBOOK');
            if (existingLogbook && existingLogbook.startLine === existingPropsDrawer.endLine + 1) {
                insertLine = existingLogbook.endLine + 1;
                if (addingNewProp) {
                    insertLine += 1;
                }
            }
        } else {
            // We're creating props drawer, log entry goes at same position (will be stacked after)
            insertLine = findPropertiesInsertionPoint(document, headingLine);
        }
        log.debug(`Inserting log entry into body at line ${insertLine}`);
        const insertPos = new vscode.Position(insertLine, 0);
        allEdits.push({
            range: new vscode.Range(insertPos, insertPos),
            newText: `${entry}\n`
        });
    }

    log.debug(`Total edits: ${allEdits.length}`);
    for (let i = 0; i < allEdits.length; i++) {
        const edit = allEdits[i];
        log.debug(`Edit ${i}: line ${edit.range.start.line}, isEmpty=${edit.range.isEmpty}, text="${edit.newText.substring(0, 40).replace(/\n/g, '\\n')}..."`);
    }

    return allEdits;
}
