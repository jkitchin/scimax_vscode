/**
 * TODO state parsing and management for org-mode files
 * Supports #+TODO: and #+SEQ_TODO: in-buffer keywords
 *
 * The pure keyword parsing lives in shared/todoKeywords.ts (so the
 * vscode-free database indexer can use it) and is re-exported here.
 */

import * as vscode from 'vscode';
import type { TodoWorkflow } from '../shared/todoKeywords';
import {
    DEFAULT_TODO_WORKFLOW,
    DEFAULT_TODO_STATES,
    parseTodoKeywordLine,
    parseTodoKeywords
} from '../shared/todoKeywords';

export type { TodoWorkflow };
export {
    DEFAULT_TODO_WORKFLOW,
    DEFAULT_TODO_STATES,
    parseTodoKeywordLine,
    parseTodoKeywords
};

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
 * Set of all TODO states for raw document text (parsed #+TODO keywords plus
 * defaults). Pure variant of getAllTodoStatesForDocument for code that works on
 * text rather than a TextDocument.
 */
export function getTodoStatesFromText(content: string): Set<string> {
    const states = new Set<string>(DEFAULT_TODO_STATES);
    const workflow = parseTodoKeywords(content);
    if (workflow) {
        for (const state of workflow.allStates) states.add(state);
    }
    return states;
}

/**
 * Extract the clean title from a headline line, stripping the leading stars,
 * an optional TODO keyword (including custom/emoji keywords), an optional
 * COMMENT marker and priority cookie, and trailing tags. This is the title that
 * a fuzzy link [[Title]] resolves against.
 */
export function extractHeadingTitle(headlineLine: string, todoStates: Set<string>): string {
    const m = headlineLine.match(/^\*+\s+(.*)$/);
    if (!m) return '';
    let rest = m[1].trim();
    // Trailing tags (:a:b:)
    rest = rest.replace(/\s+:[\w@#%:]+:\s*$/, '').trim();
    // Leading COMMENT keyword
    rest = rest.replace(/^COMMENT\s+/, '');
    // Leading TODO keyword (exact token match against the document's states)
    const sp = rest.indexOf(' ');
    const firstToken = sp === -1 ? rest : rest.slice(0, sp);
    if (todoStates.has(firstToken)) {
        rest = sp === -1 ? '' : rest.slice(sp + 1).trim();
    }
    // Leading priority cookie [#A]
    rest = rest.replace(/^\[#[A-Za-z0-9]\]\s*/, '').trim();
    return rest;
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
