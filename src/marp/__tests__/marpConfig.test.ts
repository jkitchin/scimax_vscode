import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findMarpCliConfig, isMarpConfigFile, parseMarpCliConfig } from '../marpConfig';

let root: string;

function write(file: string, text: string): string {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
    return full;
}

beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'marpconfig-')));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe('Marp CLI configuration', () => {
    it('reads themeSet folders, html and math from .marprc.yml', () => {
        const a = write('theme/mdsrely.css', '/* @theme mdsrely */');
        const b = write('theme/extra/b.css', '/* @theme b */');
        write('theme/logo.png', '');
        const file = write('.marprc.yml', 'themeSet: ./theme\nhtml: true\noptions:\n  math: katex\n');
        expect(findMarpCliConfig(path.join(root, 'talks', 'one'), root)).toEqual({
            file, themeFiles: [b, a], html: true, math: 'katex',
        });
    });

    it('takes theme files and lists, skipping missing ones', () => {
        const a = write('a.css', '');
        const config = parseMarpCliConfig(path.join(root, '.marprc.json'), '{"themeSet": ["a.css", "missing.css"]}');
        expect(config?.themeFiles).toEqual([a]);
        expect(config?.html).toBeUndefined();
    });

    it('uses the nearest file and stops at the workspace folder', () => {
        write('.marprc.yml', 'html: true\n');
        write('talks/.marprc', 'html: false\n');
        expect(findMarpCliConfig(path.join(root, 'talks'), root)?.html).toBe(false);
        expect(findMarpCliConfig(path.join(root, 'other'), path.join(root, 'other'))).toBeUndefined();
    });

    it('reads the marp key of package.json and skips a package.json without one', () => {
        write('package.json', '{"name": "x"}');
        write('.marprc.yml', 'html: true\n');
        expect(findMarpCliConfig(root, root)?.file).toBe(path.join(root, '.marprc.yml'));
        write('package.json', '{"marp": {"html": false}}');
        expect(findMarpCliConfig(root, root)?.html).toBe(false);
    });

    it('ignores files that do not parse', () => {
        expect(parseMarpCliConfig('/x/.marprc.yml', 'html: [')).toBeUndefined();
        expect(isMarpConfigFile('/x/.marprc.yml')).toBe(true);
        expect(isMarpConfigFile('/x/marp.config.js')).toBe(false);
    });
});
