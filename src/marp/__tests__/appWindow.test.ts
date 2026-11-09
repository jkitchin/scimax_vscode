import { describe, it, expect } from 'vitest';
import { appWindowCommand, findAppBrowser, resolveAppBrowser, BrowserSearch } from '../appWindow';

const search = (platform: NodeJS.Platform, files: string[], env: NodeJS.ProcessEnv = {}): BrowserSearch => ({
    platform, env, home: '/Users/me', exists: f => files.includes(f),
});

describe('app window browser search', () => {
    it('finds Chrome first on macOS, in /Applications or ~/Applications', () => {
        expect(findAppBrowser(search('darwin', ['/Applications/Microsoft Edge.app', '/Users/me/Applications/Google Chrome.app'])))
            .toBe('/Users/me/Applications/Google Chrome.app');
        expect(findAppBrowser(search('darwin', ['/Applications/Brave Browser.app']))).toBe('/Applications/Brave Browser.app');
        expect(findAppBrowser(search('darwin', []))).toBeUndefined();
    });

    it('searches PATH on Linux', () => {
        expect(findAppBrowser(search('linux', ['/snap/bin/chromium'], { PATH: '/usr/bin:/snap/bin' }))).toBe('/snap/bin/chromium');
    });

    it('looks in Program Files and LocalAppData on Windows', () => {
        const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
        expect(findAppBrowser(search('win32', [edge], { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' })))
            .toBe(edge);
    });

    it('uses the configured browser, by path or (macOS) by name', () => {
        expect(resolveAppBrowser('/opt/chrome/chrome', search('linux', ['/opt/chrome/chrome']))).toBe('/opt/chrome/chrome');
        expect(resolveAppBrowser('Microsoft Edge', search('darwin', ['/Applications/Microsoft Edge.app']))).toBe('/Applications/Microsoft Edge.app');
        expect(resolveAppBrowser('Nope', search('darwin', ['/Applications/Google Chrome.app']))).toBeUndefined();
        expect(resolveAppBrowser('  ', search('darwin', ['/Applications/Google Chrome.app']))).toBe('/Applications/Google Chrome.app');
    });

    it('builds the launch command', () => {
        expect(appWindowCommand('/Applications/Google Chrome.app', 'file:///t/deck.html', 'darwin'))
            .toEqual({ command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--app=file:///t/deck.html'] });
        expect(appWindowCommand('/usr/bin/chromium', 'file:///t/deck.html', 'linux'))
            .toEqual({ command: '/usr/bin/chromium', args: ['--app=file:///t/deck.html'] });
    });
});
