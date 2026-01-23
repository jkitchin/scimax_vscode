/**
 * TODO state parsing and management for org-mode files
 * Supports #+TODO: and #+SEQ_TODO: in-buffer keywords
 *
 * Format: #+TODO: STATE1 STATE2 | DONE1 DONE2
 * The | separates active (incomplete) states from done (complete) states
 * If no | is present, the last state is considered done
 */

import * as vscode from 'vscode';

/**
 * Represents the TODO workflow states for a document
 */
export interface TodoWorkflow {
    /** All states in order for cycling */
    allStates: string[];
    /** Active (incomplete) states */
    activeStates: string[];
    /** Done (complete) states */
    doneStates: string[];
}

/** Default TODO workflow when no custom states are defined */
export const DEFAULT_TODO_WORKFLOW: TodoWorkflow = {
    allStates: ['TODO', 'DONE'],
    activeStates: ['TODO'],
    doneStates: ['DONE']
};

/** Extended default states recognized by the parser */
export const DEFAULT_TODO_STATES = [
    'TODO', 'NEXT', 'WAIT', 'WAITING', 'HOLD', 'SOMEDAY',
    'DONE', 'CANCELLED', 'CANCELED', 'IN-PROGRESS'
];

/**
 * Parse a #+TODO: or #+SEQ_TODO: line to extract workflow states
 *
 * Format examples:
 *   #+TODO: TODO REVIEW | DONE CANCELLED
 *   #+SEQ_TODO: PROPOSAL APPROVED | MERGED
 *   #+TODO: TODO DOING DONE  (no |, last state is done)
 */
export function parseTodoKeywordLine(line: string): TodoWorkflow | null {
    // Match #+TODO: or #+SEQ_TODO: (TYP_TODO is less common but also valid)
    const match = line.match(/^#\+(TODO|SEQ_TODO|TYP_TODO):\s*(.*)$/i);
    if (!match) {
        return null;
    }

    const statesString = match[2].trim();
    if (!statesString) {
        return null;
    }

    // Check for | separator
    const pipeIndex = statesString.indexOf('|');

    let activeStates: string[];
    let doneStates: string[];

    if (pipeIndex >= 0) {
        // Split by |
        const beforePipe = statesString.slice(0, pipeIndex).trim();
        const afterPipe = statesString.slice(pipeIndex + 1).trim();

        activeStates = beforePipe.split(/\s+/).filter(s => s.length > 0);
        doneStates = afterPipe.split(/\s+/).filter(s => s.length > 0);
    } else {
        // No |, last state is done
        const allParsed = statesString.split(/\s+/).filter(s => s.length > 0);
        if (allParsed.length === 0) {
            return null;
        }
        if (allParsed.length === 1) {
            // Only one state, treat it as active (incomplete)
            activeStates = allParsed;
            doneStates = [];
        } else {
            // Last state is done
            activeStates = allParsed.slice(0, -1);
            doneStates = [allParsed[allParsed.length - 1]];
        }
    }

    if (activeStates.length === 0 && doneStates.length === 0) {
        return null;
    }

    return {
        allStates: [...activeStates, ...doneStates],
        activeStates,
        doneStates
    };
}

/**
 * Parse all TODO keyword definitions from document text
 * Multiple #+TODO: lines are combined into a single workflow
 */
export function parseTodoKeywords(content: string): TodoWorkflow | null {
    const lines = content.split('\n');
    const combinedActive: string[] = [];
    const combinedDone: string[] = [];

    for (const line of lines) {
        // Stop parsing after first heading (keywords must be at top of file)
        if (line.match(/^\*+\s/)) {
            break;
        }

        const workflow = parseTodoKeywordLine(line);
        if (workflow) {
            combinedActive.push(...workflow.activeStates);
            combinedDone.push(...workflow.doneStates);
        }
    }

    if (combinedActive.length === 0 && combinedDone.length === 0) {
        return null;
    }

    // Remove duplicates while preserving order
    const uniqueActive = [...new Set(combinedActive)];
    const uniqueDone = [...new Set(combinedDone)];

    return {
        allStates: [...uniqueActive, ...uniqueDone],
        activeStates: uniqueActive,
        doneStates: uniqueDone
    };
}

/**
 * Get TODO workflow for a VS Code document
 * Parses #+TODO: keywords from the document, falls back to defaults
 */
export function getTodoWorkflowForDocument(document: vscode.TextDocument): TodoWorkflow {
    const content = document.getText();
    const parsed = parseTodoKeywords(content);
    return parsed || DEFAULT_TODO_WORKFLOW;
}

/**
 * Get all recognized TODO states for a document (for parsing/highlighting)
 * This includes both file-specific and default states to ensure
 * existing documents with standard keywords still work
 */
export function getAllTodoStatesForDocument(document: vscode.TextDocument): Set<string> {
    const workflow = getTodoWorkflowForDocument(document);
    const states = new Set<string>(workflow.allStates);

    // Also include default states for backward compatibility
    for (const state of DEFAULT_TODO_STATES) {
        states.add(state);
    }

    return states;
}

/**
 * Check if a state is a "done" state for the given document
 */
export function isDoneState(state: string, document: vscode.TextDocument): boolean {
    const workflow = getTodoWorkflowForDocument(document);
    return workflow.doneStates.includes(state);
}

/**
 * Check if a state is an "active" (incomplete) state for the given document
 */
export function isActiveState(state: string, document: vscode.TextDocument): boolean {
    const workflow = getTodoWorkflowForDocument(document);
    return workflow.activeStates.includes(state);
}

/**
 * Get the next state in the TODO cycle for a document
 * Cycles: (no state) -> first active -> ... -> first done -> ... -> (no state)
 */
export function getNextTodoState(currentState: string | undefined, document: vscode.TextDocument): string {
    const workflow = getTodoWorkflowForDocument(document);
    const allStates = ['', ...workflow.allStates]; // Include empty state for cycling

    const currentIndex = allStates.indexOf(currentState || '');
    const nextIndex = (currentIndex + 1) % allStates.length;

    return allStates[nextIndex];
}

/**
 * Get the previous state in the TODO cycle for a document
 * Cycles backward: (no state) -> last done -> ... -> first active -> (no state)
 */
export function getPreviousTodoState(currentState: string | undefined, document: vscode.TextDocument): string {
    const workflow = getTodoWorkflowForDocument(document);
    const allStates = ['', ...workflow.allStates]; // Include empty state for cycling

    const currentIndex = allStates.indexOf(currentState || '');
    const prevIndex = (currentIndex - 1 + allStates.length) % allStates.length;

    return allStates[prevIndex];
}
