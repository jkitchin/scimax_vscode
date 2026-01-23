/**
 * Tests for progress logging functionality
 * Tests the pure functions for logging repeating task state changes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock vscode module before importing progressLogging
vi.mock('vscode', () => {
    class Position {
        constructor(
            public line: number,
            public character: number
        ) {}
    }

    class Range {
        start: Position;
        end: Position;
        constructor(
            startLine: number | Position,
            startCharacter: number | Position,
            endLine?: number,
            endCharacter?: number
        ) {
            if (startLine instanceof Position && startCharacter instanceof Position) {
                this.start = startLine;
                this.end = startCharacter;
            } else {
                this.start = new Position(startLine as number, startCharacter as number);
                this.end = new Position(endLine!, endCharacter!);
            }
        }
        static isRange(thing: unknown): boolean {
            return thing instanceof Range;
        }
    }

    return {
        Range,
        Position,
        workspace: {
            getConfiguration: () => ({
                get: (key: string, defaultValue: unknown) => defaultValue
            })
        }
    };
});

// Import vscode types for creating mock documents
import * as vscode from 'vscode';

import {
    formatInactiveTimestamp,
    formatStateChangeEntry,
    parseStartupLogRepeat,
    parseStartupLogDrawer,
    parseLoggingProperty,
    findPropertiesDrawer,
    findDrawer,
    findLogbookDrawer,
    findPlanningLinesEnd,
    findPropertiesInsertionPoint,
    findLogInsertionPoint,
    buildLastRepeatEdits,
    buildLogEntryEdits,
    getPropertyValue,
    getLoggingProperty
} from '../progressLogging';

// Mock vscode.TextDocument
function createMockDocument(lines: string[]): vscode.TextDocument {
    return {
        lineCount: lines.length,
        lineAt: (lineNumber: number) => ({
            text: lines[lineNumber],
            range: new vscode.Range(lineNumber, 0, lineNumber, lines[lineNumber].length)
        }),
        getText: () => lines.join('\n'),
        languageId: 'org'
    } as unknown as vscode.TextDocument;
}

describe('Progress Logging', () => {
    describe('formatInactiveTimestamp', () => {
        it('formats date correctly', () => {
            // January 23, 2026, 7:31 AM on a Friday
            const date = new Date(2026, 0, 23, 7, 31);
            const result = formatInactiveTimestamp(date);

            expect(result).toBe('[2026-01-23 Fri 07:31]');
        });

        it('pads single digit month and day', () => {
            // Jan 4, 2026 is a Sunday
            const date = new Date(2026, 0, 4, 9, 5);
            const result = formatInactiveTimestamp(date);

            expect(result).toBe('[2026-01-04 Sun 09:05]');
        });

        it('handles all days of week', () => {
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            for (let i = 0; i < 7; i++) {
                // January 18-24, 2026 covers Sun-Sat
                const date = new Date(2026, 0, 18 + i, 12, 0);
                const result = formatInactiveTimestamp(date);
                expect(result).toContain(days[i]);
            }
        });

        it('handles midnight', () => {
            const date = new Date(2026, 0, 23, 0, 0);
            const result = formatInactiveTimestamp(date);

            expect(result).toBe('[2026-01-23 Fri 00:00]');
        });

        it('handles end of day', () => {
            const date = new Date(2026, 0, 23, 23, 59);
            const result = formatInactiveTimestamp(date);

            expect(result).toBe('[2026-01-23 Fri 23:59]');
        });
    });

    describe('formatStateChangeEntry', () => {
        it('formats state change with padding', () => {
            const date = new Date(2026, 0, 23, 7, 31);
            const result = formatStateChangeEntry('DONE', 'TODO', date);

            expect(result).toBe('- State "DONE"       from "TODO"       [2026-01-23 Fri 07:31]');
        });

        it('handles undefined from state', () => {
            const date = new Date(2026, 0, 23, 7, 31);
            const result = formatStateChangeEntry('TODO', undefined, date);

            expect(result).toContain('from "undefined"');
        });

        it('handles long state names', () => {
            const date = new Date(2026, 0, 23, 7, 31);
            const result = formatStateChangeEntry('VERYLONGSTATE', 'ANOTHERLONGSTATE', date);

            // Should still contain the states
            expect(result).toContain('"VERYLONGSTATE"');
            expect(result).toContain('"ANOTHERLONGSTATE"');
        });

        it('includes note on new line', () => {
            const date = new Date(2026, 0, 23, 7, 31);
            const result = formatStateChangeEntry('DONE', 'TODO', date, 'Completed early');

            expect(result).toContain('[2026-01-23 Fri 07:31] \\\\');
            expect(result).toContain('\n  Completed early');
        });
    });

    describe('parseStartupLogRepeat', () => {
        it('returns undefined when no STARTUP keyword', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                'Some content'
            ]);
            expect(parseStartupLogRepeat(doc)).toBeUndefined();
        });

        it('parses nologrepeat', () => {
            const doc = createMockDocument([
                '#+STARTUP: nologrepeat',
                '* TODO Test heading'
            ]);
            expect(parseStartupLogRepeat(doc)).toBe('false');
        });

        it('parses logrepeat', () => {
            const doc = createMockDocument([
                '#+STARTUP: logrepeat',
                '* TODO Test heading'
            ]);
            expect(parseStartupLogRepeat(doc)).toBe('time');
        });

        it('parses lognoterepeat', () => {
            const doc = createMockDocument([
                '#+STARTUP: lognoterepeat',
                '* TODO Test heading'
            ]);
            expect(parseStartupLogRepeat(doc)).toBe('note');
        });

        it('handles mixed case', () => {
            const doc = createMockDocument([
                '#+STARTUP: LogRepeat',
                '* TODO Test heading'
            ]);
            expect(parseStartupLogRepeat(doc)).toBe('time');
        });

        it('handles multiple keywords in STARTUP', () => {
            const doc = createMockDocument([
                '#+STARTUP: showall logrepeat indent',
                '* TODO Test heading'
            ]);
            expect(parseStartupLogRepeat(doc)).toBe('time');
        });

        it('last occurrence wins', () => {
            const doc = createMockDocument([
                '#+STARTUP: logrepeat',
                '#+STARTUP: nologrepeat',
                '* TODO Test heading'
            ]);
            expect(parseStartupLogRepeat(doc)).toBe('false');
        });

        it('handles keyword anywhere in line', () => {
            const doc = createMockDocument([
                '#+STARTUP: overview logdrawer lognoterepeat',
                '* TODO Test heading'
            ]);
            expect(parseStartupLogRepeat(doc)).toBe('note');
        });
    });

    describe('parseStartupLogDrawer', () => {
        it('returns undefined when no drawer keyword', () => {
            const doc = createMockDocument([
                '#+STARTUP: logrepeat',
                '* TODO Test heading'
            ]);
            expect(parseStartupLogDrawer(doc)).toBeUndefined();
        });

        it('parses logdrawer', () => {
            const doc = createMockDocument([
                '#+STARTUP: logdrawer',
                '* TODO Test heading'
            ]);
            expect(parseStartupLogDrawer(doc)).toBe(true);
        });

        it('parses nologdrawer', () => {
            const doc = createMockDocument([
                '#+STARTUP: nologdrawer',
                '* TODO Test heading'
            ]);
            expect(parseStartupLogDrawer(doc)).toBe(false);
        });
    });

    describe('parseLoggingProperty', () => {
        it('parses logrepeat', () => {
            expect(parseLoggingProperty('logrepeat')).toBe('time');
        });

        it('parses lognoterepeat', () => {
            expect(parseLoggingProperty('lognoterepeat')).toBe('note');
        });

        it('parses nologrepeat', () => {
            expect(parseLoggingProperty('nologrepeat')).toBe('false');
        });

        it('parses nil', () => {
            expect(parseLoggingProperty('nil')).toBe('false');
        });

        it('handles mixed case', () => {
            expect(parseLoggingProperty('LogRepeat')).toBe('time');
        });

        it('handles whitespace', () => {
            expect(parseLoggingProperty('  logrepeat  ')).toBe('time');
        });

        it('returns undefined for unrecognized value', () => {
            expect(parseLoggingProperty('other')).toBeUndefined();
        });
    });

    describe('findPropertiesDrawer', () => {
        it('finds properties drawer immediately after heading', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                ':PROPERTIES:',
                ':ID: test-123',
                ':END:',
                'Some content'
            ]);
            const result = findPropertiesDrawer(doc, 0);

            expect(result).toEqual({ startLine: 1, endLine: 3 });
        });

        it('finds properties drawer after DEADLINE', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                'DEADLINE: <2026-01-30 Fri>',
                ':PROPERTIES:',
                ':ID: test-123',
                ':END:'
            ]);
            const result = findPropertiesDrawer(doc, 0);

            expect(result).toEqual({ startLine: 2, endLine: 4 });
        });

        it('finds properties drawer after SCHEDULED and DEADLINE', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                'SCHEDULED: <2026-01-25 Sun>',
                'DEADLINE: <2026-01-30 Fri>',
                ':PROPERTIES:',
                ':ID: test-123',
                ':END:'
            ]);
            const result = findPropertiesDrawer(doc, 0);

            expect(result).toEqual({ startLine: 3, endLine: 5 });
        });

        it('returns null when no properties drawer', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                'Some content',
                'More content'
            ]);
            const result = findPropertiesDrawer(doc, 0);

            expect(result).toBeNull();
        });

        it('returns null when content before drawer', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                'Some content first',
                ':PROPERTIES:',
                ':ID: test-123',
                ':END:'
            ]);
            const result = findPropertiesDrawer(doc, 0);

            expect(result).toBeNull();
        });
    });

    describe('getPropertyValue', () => {
        it('gets property value', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                ':PROPERTIES:',
                ':ID: test-123',
                ':LOGGING: logrepeat',
                ':END:'
            ]);
            const result = getPropertyValue(doc, 0, 'LOGGING');

            expect(result).toBe('logrepeat');
        });

        it('returns undefined when property not found', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                ':PROPERTIES:',
                ':ID: test-123',
                ':END:'
            ]);
            const result = getPropertyValue(doc, 0, 'LOGGING');

            expect(result).toBeUndefined();
        });

        it('returns undefined when no drawer', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                'Some content'
            ]);
            const result = getPropertyValue(doc, 0, 'LOGGING');

            expect(result).toBeUndefined();
        });

        it('handles case insensitive property names', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                ':PROPERTIES:',
                ':logging: logrepeat',
                ':END:'
            ]);
            const result = getPropertyValue(doc, 0, 'LOGGING');

            expect(result).toBe('logrepeat');
        });
    });

    describe('getLoggingProperty', () => {
        it('gets LOGGING property', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                ':PROPERTIES:',
                ':LOGGING: lognoterepeat',
                ':END:'
            ]);
            const result = getLoggingProperty(doc, 0);

            expect(result).toBe('lognoterepeat');
        });
    });

    describe('findDrawer', () => {
        it('finds named drawer', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                ':PROPERTIES:',
                ':ID: test-123',
                ':END:',
                ':LOGBOOK:',
                '- State "DONE" from "TODO"',
                ':END:'
            ]);
            const result = findDrawer(doc, 0, 'LOGBOOK');

            expect(result).toEqual({ startLine: 4, endLine: 6 });
        });

        it('returns null when drawer not found', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                ':PROPERTIES:',
                ':ID: test-123',
                ':END:'
            ]);
            const result = findDrawer(doc, 0, 'LOGBOOK');

            expect(result).toBeNull();
        });

        it('stops at next heading', () => {
            const doc = createMockDocument([
                '* TODO First heading',
                'Some content',
                '* TODO Second heading',
                ':LOGBOOK:',
                ':END:'
            ]);
            const result = findDrawer(doc, 0, 'LOGBOOK');

            expect(result).toBeNull();
        });
    });

    describe('findLogbookDrawer', () => {
        it('finds LOGBOOK drawer', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                ':LOGBOOK:',
                '- State "DONE" from "TODO"',
                ':END:'
            ]);
            const result = findLogbookDrawer(doc, 0);

            expect(result).toEqual({ startLine: 1, endLine: 3 });
        });
    });

    describe('findPlanningLinesEnd', () => {
        it('finds DEADLINE line', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                'DEADLINE: <2026-01-30 Fri>',
                'Some content'
            ]);
            const result = findPlanningLinesEnd(doc, 0);

            expect(result).toBe(1);
        });

        it('finds SCHEDULED line', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                'SCHEDULED: <2026-01-25 Sun>',
                'Some content'
            ]);
            const result = findPlanningLinesEnd(doc, 0);

            expect(result).toBe(1);
        });

        it('finds last of multiple planning lines', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                'SCHEDULED: <2026-01-25 Sun>',
                'DEADLINE: <2026-01-30 Fri>',
                'Some content'
            ]);
            const result = findPlanningLinesEnd(doc, 0);

            expect(result).toBe(2);
        });

        it('returns -1 when no planning lines', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                'Some content'
            ]);
            const result = findPlanningLinesEnd(doc, 0);

            expect(result).toBe(-1);
        });

        it('stops at drawer', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                ':PROPERTIES:',
                ':ID: test',
                ':END:',
                'DEADLINE: <2026-01-30 Fri>'
            ]);
            const result = findPlanningLinesEnd(doc, 0);

            // Should not find the DEADLINE after the drawer
            expect(result).toBe(-1);
        });
    });

    describe('findPropertiesInsertionPoint', () => {
        it('returns line after heading when no planning lines', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                'Some content'
            ]);
            const result = findPropertiesInsertionPoint(doc, 0);

            expect(result).toBe(1);
        });

        it('returns line after DEADLINE', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                'DEADLINE: <2026-01-30 Fri>',
                'Some content'
            ]);
            const result = findPropertiesInsertionPoint(doc, 0);

            expect(result).toBe(2);
        });

        it('returns line after last planning line', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                'SCHEDULED: <2026-01-25 Sun>',
                'DEADLINE: <2026-01-30 Fri>',
                'Some content'
            ]);
            const result = findPropertiesInsertionPoint(doc, 0);

            expect(result).toBe(3);
        });
    });

    describe('findLogInsertionPoint', () => {
        describe('when logIntoDrawer is false', () => {
            it('returns line after heading when minimal', () => {
                const doc = createMockDocument([
                    '* TODO Test heading',
                    'Some content'
                ]);
                const result = findLogInsertionPoint(doc, 0, false);

                expect(result).toEqual({
                    line: 1,
                    needsDrawer: false,
                    drawerName: null
                });
            });

            it('returns line after properties drawer', () => {
                const doc = createMockDocument([
                    '* TODO Test heading',
                    ':PROPERTIES:',
                    ':ID: test',
                    ':END:',
                    'Some content'
                ]);
                const result = findLogInsertionPoint(doc, 0, false);

                expect(result).toEqual({
                    line: 4,
                    needsDrawer: false,
                    drawerName: null
                });
            });
        });

        describe('when logIntoDrawer is true', () => {
            it('finds existing LOGBOOK', () => {
                const doc = createMockDocument([
                    '* TODO Test heading',
                    ':LOGBOOK:',
                    '- Old entry',
                    ':END:'
                ]);
                const result = findLogInsertionPoint(doc, 0, true);

                expect(result).toEqual({
                    line: 2,
                    needsDrawer: false,
                    drawerName: null
                });
            });

            it('needs new LOGBOOK after properties', () => {
                const doc = createMockDocument([
                    '* TODO Test heading',
                    ':PROPERTIES:',
                    ':ID: test',
                    ':END:',
                    'Some content'
                ]);
                const result = findLogInsertionPoint(doc, 0, true);

                expect(result).toEqual({
                    line: 4,
                    needsDrawer: true,
                    drawerName: 'LOGBOOK'
                });
            });

            it('needs new LOGBOOK when no properties', () => {
                const doc = createMockDocument([
                    '* TODO Test heading',
                    'DEADLINE: <2026-01-30 Fri>',
                    'Some content'
                ]);
                const result = findLogInsertionPoint(doc, 0, true);

                expect(result).toEqual({
                    line: 2,
                    needsDrawer: true,
                    drawerName: 'LOGBOOK'
                });
            });
        });

        describe('when logIntoDrawer is a custom string', () => {
            it('finds existing custom drawer', () => {
                const doc = createMockDocument([
                    '* TODO Test heading',
                    ':MYLOG:',
                    '- Old entry',
                    ':END:'
                ]);
                const result = findLogInsertionPoint(doc, 0, 'MYLOG');

                expect(result).toEqual({
                    line: 2,
                    needsDrawer: false,
                    drawerName: null
                });
            });

            it('needs new custom drawer', () => {
                const doc = createMockDocument([
                    '* TODO Test heading',
                    'Some content'
                ]);
                const result = findLogInsertionPoint(doc, 0, 'MYLOG');

                expect(result).toEqual({
                    line: 1,
                    needsDrawer: true,
                    drawerName: 'MYLOG'
                });
            });
        });
    });

    describe('buildLastRepeatEdits', () => {
        it('creates new properties drawer when none exists', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                'DEADLINE: <2026-01-30 Fri +1w>',
                'Some content'
            ]);
            const timestamp = new Date(2026, 0, 23, 7, 31);
            const edits = buildLastRepeatEdits(doc, 0, timestamp);

            expect(edits.length).toBe(1);
            expect(edits[0].newText).toContain(':PROPERTIES:');
            expect(edits[0].newText).toContain(':LAST_REPEAT: [2026-01-23 Fri 07:31]');
            expect(edits[0].newText).toContain(':END:');
        });

        it('adds LAST_REPEAT to existing drawer', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                ':PROPERTIES:',
                ':ID: test-123',
                ':END:',
                'Some content'
            ]);
            const timestamp = new Date(2026, 0, 23, 7, 31);
            const edits = buildLastRepeatEdits(doc, 0, timestamp);

            expect(edits.length).toBe(1);
            expect(edits[0].newText).toBe(':LAST_REPEAT: [2026-01-23 Fri 07:31]\n');
            expect(edits[0].range.start.line).toBe(2);
        });

        it('updates existing LAST_REPEAT', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                ':PROPERTIES:',
                ':LAST_REPEAT: [2026-01-16 Fri 07:31]',
                ':END:'
            ]);
            const timestamp = new Date(2026, 0, 23, 7, 31);
            const edits = buildLastRepeatEdits(doc, 0, timestamp);

            expect(edits.length).toBe(1);
            expect(edits[0].newText).toBe(':LAST_REPEAT: [2026-01-23 Fri 07:31]');
            expect(edits[0].range.start.line).toBe(2);
        });
    });

    describe('buildLogEntryEdits', () => {
        it('creates log entry in body', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                ':PROPERTIES:',
                ':ID: test-123',
                ':END:',
                'Some content'
            ]);
            const timestamp = new Date(2026, 0, 23, 7, 31);
            const edits = buildLogEntryEdits(doc, 0, 'DONE', 'TODO', false, timestamp);

            expect(edits.length).toBe(1);
            expect(edits[0].newText).toContain('- State "DONE"');
            expect(edits[0].newText).toContain('from "TODO"');
            expect(edits[0].range.start.line).toBe(4);
        });

        it('creates log entry with new LOGBOOK drawer', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                ':PROPERTIES:',
                ':ID: test-123',
                ':END:',
                'Some content'
            ]);
            const timestamp = new Date(2026, 0, 23, 7, 31);
            const edits = buildLogEntryEdits(doc, 0, 'DONE', 'TODO', true, timestamp);

            expect(edits.length).toBe(1);
            expect(edits[0].newText).toContain(':LOGBOOK:');
            expect(edits[0].newText).toContain('- State "DONE"');
            expect(edits[0].newText).toContain(':END:');
        });

        it('inserts into existing LOGBOOK at top', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                ':LOGBOOK:',
                '- Old entry',
                ':END:'
            ]);
            const timestamp = new Date(2026, 0, 23, 7, 31);
            const edits = buildLogEntryEdits(doc, 0, 'DONE', 'TODO', true, timestamp);

            expect(edits.length).toBe(1);
            expect(edits[0].range.start.line).toBe(2); // After :LOGBOOK: line
            expect(edits[0].newText).not.toContain(':LOGBOOK:'); // Don't create new drawer
        });

        it('includes note when provided', () => {
            const doc = createMockDocument([
                '* TODO Test heading',
                'Some content'
            ]);
            const timestamp = new Date(2026, 0, 23, 7, 31);
            const edits = buildLogEntryEdits(doc, 0, 'DONE', 'TODO', false, timestamp, 'Completed early');

            expect(edits[0].newText).toContain('Completed early');
        });
    });
});
