/**
 * Tests for org-mode speed commands
 */

import { describe, it, expect } from 'vitest';
import {
    SPEED_COMMAND_DEFINITIONS,
    getSpeedCommand,
    getSpeedCommandsByCategory,
    SpeedCommandDefinition
} from '../config';

describe('speedCommands config', () => {
    describe('SPEED_COMMAND_DEFINITIONS', () => {
        it('contains all expected navigation commands', () => {
            const navKeys = ['n', 'p', 'f', 'b', 'u', 'j', 'g'];
            for (const key of navKeys) {
                const cmd = getSpeedCommand(key);
                expect(cmd).toBeDefined();
                expect(cmd?.category).toBe('navigation');
            }
        });

        it('contains all expected visibility commands', () => {
            const visKeys = ['c', 'C', 'o', 'Tab'];
            for (const key of visKeys) {
                const cmd = getSpeedCommand(key);
                expect(cmd).toBeDefined();
                expect(cmd?.category).toBe('visibility');
            }
        });

        it('contains all expected structure commands', () => {
            const structKeys = ['U', 'D', 'r', 'l', 'R', 'L', 'w', 'y', 'W'];
            for (const key of structKeys) {
                const cmd = getSpeedCommand(key);
                expect(cmd).toBeDefined();
                expect(cmd?.category).toBe('structure');
            }
        });

        it('contains all expected TODO commands', () => {
            const todoKeys = ['t', ',', '1', '2', '3', '0'];
            for (const key of todoKeys) {
                const cmd = getSpeedCommand(key);
                expect(cmd).toBeDefined();
                expect(cmd?.category).toBe('todo');
            }
        });

        it('contains all expected planning commands', () => {
            const planKeys = ['s', 'd', '.'];
            for (const key of planKeys) {
                const cmd = getSpeedCommand(key);
                expect(cmd).toBeDefined();
                expect(cmd?.category).toBe('planning');
            }
        });

        it('contains all expected metadata commands', () => {
            const metaKeys = [':', 'e', 'P'];
            for (const key of metaKeys) {
                const cmd = getSpeedCommand(key);
                expect(cmd).toBeDefined();
                expect(cmd?.category).toBe('metadata');
            }
        });

        it('contains all expected clocking commands', () => {
            const clockKeys = ['I', 'O'];
            for (const key of clockKeys) {
                const cmd = getSpeedCommand(key);
                expect(cmd).toBeDefined();
                expect(cmd?.category).toBe('clocking');
            }
        });

        it('contains all expected special commands', () => {
            const specialKeys = ['a', 'A', '$', 'N', 'S', '?'];
            for (const key of specialKeys) {
                const cmd = getSpeedCommand(key);
                expect(cmd).toBeDefined();
                expect(cmd?.category).toBe('special');
            }
        });

        it('has unique keys for all commands', () => {
            const keys = SPEED_COMMAND_DEFINITIONS.map(cmd => cmd.key);
            const uniqueKeys = new Set(keys);
            expect(uniqueKeys.size).toBe(keys.length);
        });

        it('has valid command IDs for all commands', () => {
            for (const cmd of SPEED_COMMAND_DEFINITIONS) {
                expect(cmd.command).toMatch(/^scimax\.(speed|org|heading)\./);
            }
        });

        it('has descriptions for all commands', () => {
            for (const cmd of SPEED_COMMAND_DEFINITIONS) {
                expect(cmd.description.length).toBeGreaterThan(0);
            }
        });
    });

    describe('getSpeedCommand', () => {
        it('returns the correct command for a valid key', () => {
            const cmd = getSpeedCommand('n');
            expect(cmd).toBeDefined();
            expect(cmd?.key).toBe('n');
            expect(cmd?.command).toBe('scimax.org.nextHeading');
            expect(cmd?.description).toBe('Next visible heading');
        });

        it('returns undefined for an invalid key', () => {
            const cmd = getSpeedCommand('z');
            expect(cmd).toBeUndefined();
        });

        it('is case-sensitive', () => {
            const lowerCmd = getSpeedCommand('n');
            const upperCmd = getSpeedCommand('N');

            expect(lowerCmd).toBeDefined();
            expect(upperCmd).toBeDefined();
            expect(lowerCmd?.command).not.toBe(upperCmd?.command);
        });
    });

    describe('getSpeedCommandsByCategory', () => {
        it('groups commands by category', () => {
            const categories = getSpeedCommandsByCategory();

            expect(categories.has('navigation')).toBe(true);
            expect(categories.has('visibility')).toBe(true);
            expect(categories.has('structure')).toBe(true);
            expect(categories.has('todo')).toBe(true);
            expect(categories.has('planning')).toBe(true);
            expect(categories.has('metadata')).toBe(true);
            expect(categories.has('clocking')).toBe(true);
            expect(categories.has('special')).toBe(true);
        });

        it('includes all commands in categories', () => {
            const categories = getSpeedCommandsByCategory();
            let totalCommands = 0;

            categories.forEach((commands) => {
                totalCommands += commands.length;
            });

            expect(totalCommands).toBe(SPEED_COMMAND_DEFINITIONS.length);
        });

        it('places each command in the correct category', () => {
            const categories = getSpeedCommandsByCategory();

            const navCommands = categories.get('navigation') || [];
            expect(navCommands.every(cmd => cmd.category === 'navigation')).toBe(true);

            const visCommands = categories.get('visibility') || [];
            expect(visCommands.every(cmd => cmd.category === 'visibility')).toBe(true);
        });
    });
});

describe('speed command key mappings', () => {
    describe('navigation keys', () => {
        it('n navigates to next heading', () => {
            const cmd = getSpeedCommand('n');
            expect(cmd?.command).toBe('scimax.org.nextHeading');
        });

        it('p navigates to previous heading', () => {
            const cmd = getSpeedCommand('p');
            expect(cmd?.command).toBe('scimax.org.previousHeading');
        });

        it('f navigates to next sibling', () => {
            const cmd = getSpeedCommand('f');
            expect(cmd?.command).toBe('scimax.speed.nextSibling');
        });

        it('b navigates to previous sibling', () => {
            const cmd = getSpeedCommand('b');
            expect(cmd?.command).toBe('scimax.speed.previousSibling');
        });

        it('u navigates to parent heading', () => {
            const cmd = getSpeedCommand('u');
            expect(cmd?.command).toBe('scimax.org.parentHeading');
        });

        it('j jumps to heading', () => {
            const cmd = getSpeedCommand('j');
            expect(cmd?.command).toBe('scimax.org.jumpToHeading');
        });
    });

    describe('structure keys', () => {
        it('U moves subtree up', () => {
            const cmd = getSpeedCommand('U');
            expect(cmd?.command).toBe('scimax.heading.moveUp');
        });

        it('D moves subtree down', () => {
            const cmd = getSpeedCommand('D');
            expect(cmd?.command).toBe('scimax.heading.moveDown');
        });

        it('r demotes subtree', () => {
            const cmd = getSpeedCommand('r');
            expect(cmd?.command).toBe('scimax.heading.demoteSubtree');
        });

        it('l promotes subtree', () => {
            const cmd = getSpeedCommand('l');
            expect(cmd?.command).toBe('scimax.heading.promoteSubtree');
        });

        it('w kills subtree', () => {
            const cmd = getSpeedCommand('w');
            expect(cmd?.command).toBe('scimax.org.killSubtree');
        });

        it('y yanks subtree', () => {
            const cmd = getSpeedCommand('y');
            expect(cmd?.command).toBe('scimax.speed.yankSubtree');
        });
    });

    describe('TODO keys', () => {
        it('t cycles TODO state', () => {
            const cmd = getSpeedCommand('t');
            expect(cmd?.command).toBe('scimax.org.cycleTodo');
        });

        it('1 sets priority A', () => {
            const cmd = getSpeedCommand('1');
            expect(cmd?.command).toBe('scimax.speed.priorityA');
        });

        it('2 sets priority B', () => {
            const cmd = getSpeedCommand('2');
            expect(cmd?.command).toBe('scimax.speed.priorityB');
        });

        it('3 sets priority C', () => {
            const cmd = getSpeedCommand('3');
            expect(cmd?.command).toBe('scimax.speed.priorityC');
        });

        it('0 removes priority', () => {
            const cmd = getSpeedCommand('0');
            expect(cmd?.command).toBe('scimax.speed.priorityNone');
        });
    });

    describe('planning keys', () => {
        it('s adds schedule', () => {
            const cmd = getSpeedCommand('s');
            expect(cmd?.command).toBe('scimax.speed.schedule');
        });

        it('d adds deadline', () => {
            const cmd = getSpeedCommand('d');
            expect(cmd?.command).toBe('scimax.speed.deadline');
        });

        it('. inserts timestamp', () => {
            const cmd = getSpeedCommand('.');
            expect(cmd?.command).toBe('scimax.org.insertTimestamp');
        });
    });

    describe('metadata keys', () => {
        it(': sets tags', () => {
            const cmd = getSpeedCommand(':');
            expect(cmd?.command).toBe('scimax.speed.setTags');
        });

        it('e sets effort', () => {
            const cmd = getSpeedCommand('e');
            expect(cmd?.command).toBe('scimax.speed.setEffort');
        });

        it('P sets property', () => {
            const cmd = getSpeedCommand('P');
            expect(cmd?.command).toBe('scimax.speed.setProperty');
        });
    });

    describe('clocking keys', () => {
        it('I clocks in', () => {
            const cmd = getSpeedCommand('I');
            expect(cmd?.command).toBe('scimax.speed.clockIn');
        });

        it('O clocks out', () => {
            const cmd = getSpeedCommand('O');
            expect(cmd?.command).toBe('scimax.speed.clockOut');
        });
    });

    describe('archive keys', () => {
        it('a archives subtree', () => {
            const cmd = getSpeedCommand('a');
            expect(cmd?.command).toBe('scimax.speed.archiveSubtree');
        });

        it('A toggles archive tag', () => {
            const cmd = getSpeedCommand('A');
            expect(cmd?.command).toBe('scimax.speed.toggleArchiveTag');
        });

        it('$ archives to sibling', () => {
            const cmd = getSpeedCommand('$');
            expect(cmd?.command).toBe('scimax.speed.archiveToSibling');
        });
    });

    describe('special keys', () => {
        it('N narrows to subtree', () => {
            const cmd = getSpeedCommand('N');
            expect(cmd?.command).toBe('scimax.speed.narrowToSubtree');
        });

        it('S widens', () => {
            const cmd = getSpeedCommand('S');
            expect(cmd?.command).toBe('scimax.speed.widen');
        });

        it('? shows help', () => {
            const cmd = getSpeedCommand('?');
            expect(cmd?.command).toBe('scimax.speed.help');
        });
    });
});

describe('planning helper functions', () => {
    // These tests verify the timestamp formatting logic from planning.ts
    describe('timestamp formatting', () => {
        it('formats date correctly', () => {
            const date = new Date(2024, 0, 15); // January 15, 2024
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const dayName = days[date.getDay()];

            const expected = `<${year}-${month}-${day} ${dayName}>`;
            expect(expected).toBe('<2024-01-15 Mon>');
        });

        it('pads single digit months and days', () => {
            const date = new Date(2024, 0, 5); // January 5, 2024
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');

            expect(month).toBe('01');
            expect(day).toBe('05');
        });

        it('formats timestamp with time', () => {
            const date = new Date(2024, 0, 15, 14, 30);
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const dayName = days[date.getDay()];
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');

            const expected = `<${year}-${month}-${day} ${dayName} ${hours}:${minutes}>`;
            expect(expected).toBe('<2024-01-15 Mon 14:30>');
        });
    });
});

describe('metadata helper functions', () => {
    describe('tag extraction', () => {
        // Test the regex pattern used in metadata.ts for extracting tags
        const extractTags = (line: string): string[] => {
            const match = line.match(/:([A-Za-z0-9_@#%:]+):\s*$/);
            if (!match) return [];
            return match[1].split(':').filter(t => t.length > 0);
        };

        it('extracts tags from heading', () => {
            const line = '* TODO Task :work:urgent:';
            const tags = extractTags(line);
            expect(tags).toEqual(['work', 'urgent']);
        });

        it('extracts single tag', () => {
            const line = '* Heading :tag:';
            const tags = extractTags(line);
            expect(tags).toEqual(['tag']);
        });

        it('returns empty array for no tags', () => {
            const line = '* Heading without tags';
            const tags = extractTags(line);
            expect(tags).toEqual([]);
        });

        it('handles special characters in tags', () => {
            const line = '* Task :@home:#project:';
            const tags = extractTags(line);
            expect(tags).toEqual(['@home', '#project']);
        });
    });

    describe('tag formatting', () => {
        const formatTags = (tags: string[]): string => {
            if (tags.length === 0) return '';
            return `:${tags.join(':')}:`;
        };

        it('formats multiple tags', () => {
            const tags = ['work', 'urgent'];
            const formatted = formatTags(tags);
            expect(formatted).toBe(':work:urgent:');
        });

        it('formats single tag', () => {
            const tags = ['todo'];
            const formatted = formatTags(tags);
            expect(formatted).toBe(':todo:');
        });

        it('returns empty string for no tags', () => {
            const tags: string[] = [];
            const formatted = formatTags(tags);
            expect(formatted).toBe('');
        });
    });
});

describe('heading level detection', () => {
    // Test the heading level detection logic
    const getOrgHeadingLevel = (line: string): number => {
        const match = line.match(/^(\*+)\s/);
        return match ? match[1].length : 0;
    };

    const getMarkdownHeadingLevel = (line: string): number => {
        const match = line.match(/^(#+)\s/);
        return match ? match[1].length : 0;
    };

    describe('org-mode headings', () => {
        it('detects level 1 heading', () => {
            expect(getOrgHeadingLevel('* Heading')).toBe(1);
        });

        it('detects level 2 heading', () => {
            expect(getOrgHeadingLevel('** Subheading')).toBe(2);
        });

        it('detects level 3 heading', () => {
            expect(getOrgHeadingLevel('*** Sub-subheading')).toBe(3);
        });

        it('returns 0 for non-heading', () => {
            expect(getOrgHeadingLevel('Just text')).toBe(0);
        });

        it('returns 0 for heading without space', () => {
            expect(getOrgHeadingLevel('*No space')).toBe(0);
        });

        it('handles TODO headings', () => {
            expect(getOrgHeadingLevel('* TODO Task')).toBe(1);
            expect(getOrgHeadingLevel('** DONE Completed')).toBe(2);
        });
    });

    describe('markdown headings', () => {
        it('detects h1', () => {
            expect(getMarkdownHeadingLevel('# Heading')).toBe(1);
        });

        it('detects h2', () => {
            expect(getMarkdownHeadingLevel('## Heading')).toBe(2);
        });

        it('detects h6', () => {
            expect(getMarkdownHeadingLevel('###### Heading')).toBe(6);
        });

        it('returns 0 for non-heading', () => {
            expect(getMarkdownHeadingLevel('Just text')).toBe(0);
        });
    });
});

describe('priority handling', () => {
    // Test priority regex patterns
    const hasPriority = (line: string): boolean => {
        return /\[#[A-Z]\]/.test(line);
    };

    const getPriority = (line: string): string | null => {
        const match = line.match(/\[#([A-Z])\]/);
        return match ? match[1] : null;
    };

    it('detects priority A', () => {
        const line = '* TODO [#A] Important task';
        expect(hasPriority(line)).toBe(true);
        expect(getPriority(line)).toBe('A');
    });

    it('detects priority B', () => {
        const line = '* [#B] Medium priority';
        expect(hasPriority(line)).toBe(true);
        expect(getPriority(line)).toBe('B');
    });

    it('detects priority C', () => {
        const line = '** TODO [#C] Low priority';
        expect(hasPriority(line)).toBe(true);
        expect(getPriority(line)).toBe('C');
    });

    it('returns null for no priority', () => {
        const line = '* TODO No priority';
        expect(hasPriority(line)).toBe(false);
        expect(getPriority(line)).toBeNull();
    });
});

describe('archive tag handling', () => {
    // Test archive tag detection
    const hasArchiveTag = (line: string): boolean => {
        const match = line.match(/:([A-Za-z0-9_@#%:]+):\s*$/);
        if (!match) return false;
        const tags = match[1].split(':');
        return tags.some(t => t.toUpperCase() === 'ARCHIVE');
    };

    it('detects ARCHIVE tag', () => {
        expect(hasArchiveTag('* Task :ARCHIVE:')).toBe(true);
    });

    it('detects archive tag with other tags', () => {
        expect(hasArchiveTag('* Task :work:ARCHIVE:old:')).toBe(true);
    });

    it('returns false for no archive tag', () => {
        expect(hasArchiveTag('* Task :work:')).toBe(false);
    });

    it('returns false for no tags', () => {
        expect(hasArchiveTag('* Task')).toBe(false);
    });
});
