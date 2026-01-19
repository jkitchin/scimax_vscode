/**
 * Tests for LaTeX speed commands configuration
 */

import { describe, it, expect } from 'vitest';
import { getSpeedCommands } from '../latexSpeedCommands';

describe('LaTeX Speed Commands', () => {
    const speedCommands = getSpeedCommands();

    describe('Speed command definitions', () => {
        it('should have navigation commands', () => {
            const navKeys = ['n', 'p', 'f', 'b', 'u', 'j', 'J', 'g', 'G'];
            for (const key of navKeys) {
                const cmd = speedCommands.find(c => c.key === key);
                expect(cmd, `Missing navigation command for key '${key}'`).toBeDefined();
            }
        });

        it('should have structure editing commands', () => {
            const structKeys = ['<', '>', 'L', 'R', 'U', 'D'];
            for (const key of structKeys) {
                const cmd = speedCommands.find(c => c.key === key);
                expect(cmd, `Missing structure command for key '${key}'`).toBeDefined();
            }
        });

        it('should have selection/editing commands', () => {
            const editKeys = ['m', 'k', 'c', 'i', 'I'];
            for (const key of editKeys) {
                const cmd = speedCommands.find(c => c.key === key);
                expect(cmd, `Missing edit command for key '${key}'`).toBeDefined();
            }
        });

        it('should have visibility commands', () => {
            const visKeys = ['N', 'W', 'Tab', 'S-Tab'];
            for (const key of visKeys) {
                const cmd = speedCommands.find(c => c.key === key);
                expect(cmd, `Missing visibility command for key '${key}'`).toBeDefined();
            }
        });

        it('should have help command', () => {
            const helpCmd = speedCommands.find(c => c.key === '?');
            expect(helpCmd).toBeDefined();
            expect(helpCmd?.description).toContain('speed');
        });
    });

    describe('Speed command properties', () => {
        it('all commands should have unique keys', () => {
            const keys = speedCommands.map(c => c.key);
            const uniqueKeys = new Set(keys);
            expect(uniqueKeys.size).toBe(keys.length);
        });

        it('all commands should have descriptions', () => {
            for (const cmd of speedCommands) {
                expect(cmd.description, `Command '${cmd.key}' missing description`).toBeTruthy();
                expect(cmd.description.length).toBeGreaterThan(0);
            }
        });

        it('all commands should have action functions', () => {
            for (const cmd of speedCommands) {
                expect(typeof cmd.action, `Command '${cmd.key}' action is not a function`).toBe('function');
            }
        });
    });

    describe('Speed command key mappings', () => {
        it('navigation keys should match org-mode conventions', () => {
            // n/p for next/previous (like org-mode)
            const nextCmd = speedCommands.find(c => c.key === 'n');
            expect(nextCmd?.description.toLowerCase()).toContain('next');

            const prevCmd = speedCommands.find(c => c.key === 'p');
            expect(prevCmd?.description.toLowerCase()).toContain('previous');

            // f/b for forward/backward siblings
            const fwdCmd = speedCommands.find(c => c.key === 'f');
            expect(fwdCmd?.description.toLowerCase()).toContain('sibling');

            const bwdCmd = speedCommands.find(c => c.key === 'b');
            expect(bwdCmd?.description.toLowerCase()).toContain('sibling');

            // u for up/parent
            const upCmd = speedCommands.find(c => c.key === 'u');
            expect(upCmd?.description.toLowerCase()).toContain('parent');
        });

        it('structure keys should be intuitive', () => {
            // < for promote (left in hierarchy)
            const promoteCmd = speedCommands.find(c => c.key === '<');
            expect(promoteCmd?.description.toLowerCase()).toContain('promote');

            // > for demote (right in hierarchy)
            const demoteCmd = speedCommands.find(c => c.key === '>');
            expect(demoteCmd?.description.toLowerCase()).toContain('demote');

            // U/D for up/down movement
            const moveUpCmd = speedCommands.find(c => c.key === 'U');
            expect(moveUpCmd?.description.toLowerCase()).toContain('up');

            const moveDownCmd = speedCommands.find(c => c.key === 'D');
            expect(moveDownCmd?.description.toLowerCase()).toContain('down');
        });

        it('editing keys should follow conventions', () => {
            // m for mark
            const markCmd = speedCommands.find(c => c.key === 'm');
            expect(markCmd?.description.toLowerCase()).toContain('mark');

            // k for kill
            const killCmd = speedCommands.find(c => c.key === 'k');
            expect(killCmd?.description.toLowerCase()).toContain('kill');

            // c for clone
            const cloneCmd = speedCommands.find(c => c.key === 'c');
            expect(cloneCmd?.description.toLowerCase()).toContain('clone');
        });
    });

    describe('Speed command count', () => {
        it('should have a reasonable number of commands', () => {
            // Should have between 15 and 30 speed commands
            expect(speedCommands.length).toBeGreaterThanOrEqual(15);
            expect(speedCommands.length).toBeLessThanOrEqual(30);
        });
    });
});
