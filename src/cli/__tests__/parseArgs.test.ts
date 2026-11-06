import { describe, it, expect } from 'vitest';
import { parseArgs } from '../parseArgs';

describe('parseArgs', () => {
    it('reads commands, positionals and flags', () => {
        const p = parseArgs(['agenda', 'todos', '--state', 'NEXT', '--json']);
        expect(p.command).toBe('agenda');
        expect(p.subcommand).toBe('todos');
        expect(p.args).toEqual(['todos']);
        expect(p.flags).toEqual({ state: 'NEXT', json: true });
    });

    it('takes a relative date as a flag value, not an option', () => {
        expect(parseArgs(['journal', '--date', '-1d', '--json']).flags).toEqual({ date: '-1d', json: true });
        expect(parseArgs(['journal', '--date', '-2w']).flags).toEqual({ date: '-2w' });
    });

    it('supports --key=value', () => {
        expect(parseArgs(['journal', '--date=-1d']).flags).toEqual({ date: '-1d' });
        expect(parseArgs(['search', '--limit=5']).flags).toEqual({ limit: '5' });
    });

    it('treats a bare relative date as a positional', () => {
        const p = parseArgs(['journal', '-3d']);
        expect(p.args).toEqual(['-3d']);
        expect(p.flags).toEqual({});
    });

    it('keeps short flags and boolean flags before another option', () => {
        expect(parseArgs(['search', 'headings', '-t', 'grant', '--todo', 'NEXT']).flags).toEqual({ t: 'grant', todo: 'NEXT' });
        expect(parseArgs(['db', 'sync', '--dry-run', '--verbose']).flags).toEqual({ 'dry-run': true, verbose: true });
    });

    it('passes through everything after --', () => {
        const p = parseArgs(['marp', 'build', 'deck.md', '--', '--html', '-1']);
        expect(p.args).toEqual(['build', 'deck.md']);
        expect(p.passthrough).toEqual(['--html', '-1']);
    });
});
