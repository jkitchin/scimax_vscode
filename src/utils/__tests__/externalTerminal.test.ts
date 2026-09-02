import { describe, it, expect } from 'vitest';
import { resolveExternalTerminal } from '../externalTerminal';

const DIR = '/Users/me/notes';

describe('resolveExternalTerminal on macOS', () => {
    it('prefers iTerm when it is installed', () => {
        const launch = resolveExternalTerminal(DIR, {
            platform: 'darwin',
            exists: name => name === 'iTerm' || name === 'Terminal'
        });
        expect(launch).toEqual({ command: 'open', args: ['-a', 'iTerm', DIR] });
    });

    it('falls back to Terminal when nothing else is installed', () => {
        const launch = resolveExternalTerminal(DIR, {
            platform: 'darwin',
            exists: () => false
        });
        expect(launch).toEqual({ command: 'open', args: ['-a', 'Terminal', DIR] });
    });

    it('honors a configured app over auto-detection', () => {
        const launch = resolveExternalTerminal(DIR, {
            platform: 'darwin',
            app: 'Warp',
            exists: () => true
        });
        expect(launch?.args).toEqual(['-a', 'Warp', DIR]);
    });
});

describe('resolveExternalTerminal on Linux', () => {
    it('picks the first available terminal and passes the directory as cwd', () => {
        const launch = resolveExternalTerminal(DIR, {
            platform: 'linux',
            exists: name => name === 'konsole' || name === 'xterm'
        });
        expect(launch).toEqual({ command: 'konsole', args: [], cwd: DIR });
    });

    it('returns undefined when no terminal is found', () => {
        expect(resolveExternalTerminal(DIR, { platform: 'linux', exists: () => false })).toBeUndefined();
    });
});

describe('resolveExternalTerminal on Windows', () => {
    it('uses Windows Terminal when present', () => {
        const launch = resolveExternalTerminal(DIR, {
            platform: 'win32',
            exists: name => name === 'wt.exe'
        });
        expect(launch?.command).toBe('wt.exe');
        expect(launch?.args).toEqual(['-d', DIR]);
    });

    it('falls back to cmd.exe start', () => {
        const launch = resolveExternalTerminal(DIR, { platform: 'win32', exists: () => false });
        expect(launch?.command).toBe('cmd.exe');
        expect(launch?.args).toContain(DIR);
    });
});

describe('explicit command setting', () => {
    it('overrides platform defaults and substitutes ${dir}', () => {
        const launch = resolveExternalTerminal(DIR, {
            platform: 'darwin',
            command: 'alacritty',
            args: ['--working-directory', '${dir}', '-e', 'zsh']
        });
        expect(launch).toEqual({
            command: 'alacritty',
            args: ['--working-directory', DIR, '-e', 'zsh'],
            cwd: DIR
        });
    });

    it('ignores a blank command', () => {
        const launch = resolveExternalTerminal(DIR, {
            platform: 'darwin',
            command: '   ',
            exists: () => false
        });
        expect(launch?.command).toBe('open');
    });
});
