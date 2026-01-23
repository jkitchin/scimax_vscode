/**
 * Tests for custom TODO state parsing and management
 * Tests #+TODO: and #+SEQ_TODO: keyword parsing
 */

import { describe, it, expect } from 'vitest';
import {
    parseTodoKeywordLine,
    parseTodoKeywords,
    DEFAULT_TODO_WORKFLOW,
    DEFAULT_TODO_STATES,
    type TodoWorkflow
} from '../todoStates';

describe('TODO States Parser', () => {
    describe('parseTodoKeywordLine', () => {
        it('should parse #+TODO: with pipe separator', () => {
            const result = parseTodoKeywordLine('#+TODO: TODO REVIEW | DONE CANCELLED');
            expect(result).not.toBeNull();
            expect(result!.activeStates).toEqual(['TODO', 'REVIEW']);
            expect(result!.doneStates).toEqual(['DONE', 'CANCELLED']);
            expect(result!.allStates).toEqual(['TODO', 'REVIEW', 'DONE', 'CANCELLED']);
        });

        it('should parse #+SEQ_TODO: with pipe separator', () => {
            const result = parseTodoKeywordLine('#+SEQ_TODO: PROPOSAL APPROVED | MERGED');
            expect(result).not.toBeNull();
            expect(result!.activeStates).toEqual(['PROPOSAL', 'APPROVED']);
            expect(result!.doneStates).toEqual(['MERGED']);
        });

        it('should parse #+TYP_TODO: with pipe separator', () => {
            const result = parseTodoKeywordLine('#+TYP_TODO: BUG FEATURE | FIXED');
            expect(result).not.toBeNull();
            expect(result!.activeStates).toEqual(['BUG', 'FEATURE']);
            expect(result!.doneStates).toEqual(['FIXED']);
        });

        it('should parse without pipe (last state is done)', () => {
            const result = parseTodoKeywordLine('#+TODO: TODO IN-PROGRESS DONE');
            expect(result).not.toBeNull();
            expect(result!.activeStates).toEqual(['TODO', 'IN-PROGRESS']);
            expect(result!.doneStates).toEqual(['DONE']);
        });

        it('should handle single state (treated as active)', () => {
            const result = parseTodoKeywordLine('#+TODO: IDEA');
            expect(result).not.toBeNull();
            expect(result!.activeStates).toEqual(['IDEA']);
            expect(result!.doneStates).toEqual([]);
        });

        it('should handle states with hyphens', () => {
            const result = parseTodoKeywordLine('#+TODO: IN-PROGRESS READY-FOR-REVIEW | DONE');
            expect(result).not.toBeNull();
            expect(result!.activeStates).toEqual(['IN-PROGRESS', 'READY-FOR-REVIEW']);
            expect(result!.doneStates).toEqual(['DONE']);
        });

        it('should handle extra whitespace', () => {
            const result = parseTodoKeywordLine('#+TODO:   TODO   REVIEW   |   DONE   ');
            expect(result).not.toBeNull();
            expect(result!.activeStates).toEqual(['TODO', 'REVIEW']);
            expect(result!.doneStates).toEqual(['DONE']);
        });

        it('should be case-insensitive for keyword', () => {
            const result = parseTodoKeywordLine('#+todo: CUSTOM | DONE');
            expect(result).not.toBeNull();
            expect(result!.activeStates).toEqual(['CUSTOM']);
        });

        it('should return null for non-TODO lines', () => {
            expect(parseTodoKeywordLine('#+TITLE: My Document')).toBeNull();
            expect(parseTodoKeywordLine('* TODO Heading')).toBeNull();
            expect(parseTodoKeywordLine('Regular text')).toBeNull();
        });

        it('should return null for empty TODO line', () => {
            expect(parseTodoKeywordLine('#+TODO:')).toBeNull();
            expect(parseTodoKeywordLine('#+TODO:   ')).toBeNull();
        });

        it('should handle only done states (after pipe)', () => {
            const result = parseTodoKeywordLine('#+TODO: | DONE CANCELLED');
            expect(result).not.toBeNull();
            expect(result!.activeStates).toEqual([]);
            expect(result!.doneStates).toEqual(['DONE', 'CANCELLED']);
        });
    });

    describe('parseTodoKeywords', () => {
        it('should parse single TODO keyword from content', () => {
            const content = `#+TITLE: Test
#+TODO: DRAFT REVIEW | PUBLISHED
* DRAFT My article`;

            const result = parseTodoKeywords(content);
            expect(result).not.toBeNull();
            expect(result!.allStates).toEqual(['DRAFT', 'REVIEW', 'PUBLISHED']);
        });

        it('should combine multiple TODO keywords', () => {
            const content = `#+TITLE: Test
#+TODO: TODO DOING | DONE
#+TODO: WAITING HOLD | CANCELLED
* TODO First task`;

            const result = parseTodoKeywords(content);
            expect(result).not.toBeNull();
            expect(result!.activeStates).toContain('TODO');
            expect(result!.activeStates).toContain('DOING');
            expect(result!.activeStates).toContain('WAITING');
            expect(result!.activeStates).toContain('HOLD');
            expect(result!.doneStates).toContain('DONE');
            expect(result!.doneStates).toContain('CANCELLED');
        });

        it('should stop parsing at first heading', () => {
            const content = `#+TITLE: Test
* Heading without TODO keywords
#+TODO: IGNORED | STATES`;

            const result = parseTodoKeywords(content);
            expect(result).toBeNull();
        });

        it('should return null if no TODO keywords', () => {
            const content = `#+TITLE: Test
#+AUTHOR: Test
* TODO Regular heading`;

            const result = parseTodoKeywords(content);
            expect(result).toBeNull();
        });

        it('should remove duplicate states', () => {
            const content = `#+TODO: TODO REVIEW | DONE
#+TODO: TODO WAITING | DONE`;

            const result = parseTodoKeywords(content);
            expect(result).not.toBeNull();
            // Count occurrences
            const todoCount = result!.activeStates.filter(s => s === 'TODO').length;
            const doneCount = result!.doneStates.filter(s => s === 'DONE').length;
            expect(todoCount).toBe(1);
            expect(doneCount).toBe(1);
        });
    });

    describe('DEFAULT_TODO_WORKFLOW', () => {
        it('should have TODO and DONE as default states', () => {
            expect(DEFAULT_TODO_WORKFLOW.allStates).toEqual(['TODO', 'DONE']);
            expect(DEFAULT_TODO_WORKFLOW.activeStates).toEqual(['TODO']);
            expect(DEFAULT_TODO_WORKFLOW.doneStates).toEqual(['DONE']);
        });
    });

    describe('DEFAULT_TODO_STATES', () => {
        it('should include common TODO states', () => {
            expect(DEFAULT_TODO_STATES).toContain('TODO');
            expect(DEFAULT_TODO_STATES).toContain('DONE');
            expect(DEFAULT_TODO_STATES).toContain('NEXT');
            expect(DEFAULT_TODO_STATES).toContain('WAITING');
            expect(DEFAULT_TODO_STATES).toContain('CANCELLED');
        });
    });
});

describe('TODO State Cycling', () => {
    describe('getNextTodoState behavior', () => {
        // Note: We can't directly test getNextTodoState here as it requires vscode.TextDocument
        // These tests document the expected behavior

        it('documents default cycling behavior', () => {
            // Default workflow: (none) -> TODO -> DONE -> (none)
            const workflow = DEFAULT_TODO_WORKFLOW;
            const allStates = ['', ...workflow.allStates];

            // Verify cycling order
            expect(allStates[0]).toBe('');
            expect(allStates[1]).toBe('TODO');
            expect(allStates[2]).toBe('DONE');
            expect(allStates.length).toBe(3);
        });

        it('documents custom workflow cycling', () => {
            // Custom: (none) -> DRAFT -> REVIEW -> PUBLISHED -> (none)
            const customWorkflow: TodoWorkflow = {
                allStates: ['DRAFT', 'REVIEW', 'PUBLISHED'],
                activeStates: ['DRAFT', 'REVIEW'],
                doneStates: ['PUBLISHED']
            };

            const allStates = ['', ...customWorkflow.allStates];
            expect(allStates).toEqual(['', 'DRAFT', 'REVIEW', 'PUBLISHED']);
        });
    });
});
