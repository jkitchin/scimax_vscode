/**
 * Manifest consistency tests.
 *
 * These guard against the class of bug found in the #47 correctness audit:
 * code that references commands or settings that are not declared in
 * package.json (and vice-versa). Each rule below corresponds to a failure
 * mode that shipped to users as a "command not found" error or a setting
 * that silently did nothing.
 *
 * The test parses package.json and greps src/**\/*.ts (no VS Code runtime),
 * so it is cheap and runs with the normal vitest suite.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// package.json contributions
// ---------------------------------------------------------------------------

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const contributes = pkg.contributes ?? {};

const configSections: any[] = Array.isArray(contributes.configuration)
    ? contributes.configuration
    : [contributes.configuration].filter(Boolean);

const registeredSettings = new Set<string>();
for (const section of configSections) {
    for (const key of Object.keys(section.properties ?? {})) registeredSettings.add(key);
}

const deprecatedSettings = new Set<string>();
for (const section of configSections) {
    for (const [key, def] of Object.entries<any>(section.properties ?? {})) {
        if (def && typeof def === 'object' && 'deprecationMessage' in def) deprecatedSettings.add(key);
    }
}

const declaredCommands = new Set<string>((contributes.commands ?? []).map((c: any) => c.command));

const viewIds = new Set<string>();
for (const views of Object.values<any>(contributes.views ?? {})) {
    for (const v of views) viewIds.add(v.id);
}

// ---------------------------------------------------------------------------
// Source scan
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
            walk(p, out);
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
            out.push(p);
        }
    }
    return out;
}

const srcFiles = walk(path.join(ROOT, 'src'));
const fileContents = new Map<string, string>();
for (const f of srcFiles) fileContents.set(f, fs.readFileSync(f, 'utf8'));
const allSrc = [...fileContents.values()].join('\n');

function rel(f: string): string {
    return path.relative(ROOT, f);
}

// Commands actually registered in code (literal registerCommand calls).
const registeredInCode = new Set<string>();
{
    const re = /registerCommand\(\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(allSrc))) registeredInCode.add(m[1] ?? m[2] ?? m[3]);
}

// ---------------------------------------------------------------------------
// Rule 1: every executeCommand('scimax.*') target is registered
// ---------------------------------------------------------------------------

describe('manifest consistency: command invocations resolve', () => {
    it('every executeCommand("scimax.*") target is registered or a known VS Code-generated view command', () => {
        // VS Code auto-generates these per registered view id.
        const generatedViewCommands = new Set<string>();
        for (const id of viewIds) {
            generatedViewCommands.add(`${id}.focus`);
            generatedViewCommands.add(`${id}.resetViewLocation`);
        }

        const violations: string[] = [];
        for (const [file, src] of fileContents) {
            const lines = src.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const re = /executeCommand\(\s*(?:'([^']+)'|"([^"]+)")/g;
                let m: RegExpExecArray | null;
                while ((m = re.exec(lines[i]))) {
                    const cmd = m[1] ?? m[2];
                    if (!cmd.startsWith('scimax')) continue;
                    if (registeredInCode.has(cmd)) continue;
                    if (generatedViewCommands.has(cmd)) continue;
                    violations.push(`${cmd}  (${rel(file)}:${i + 1})`);
                }
            }
        }
        expect(violations, `Unregistered executeCommand targets:\n  ${violations.join('\n  ')}`).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Rule 2: every declared palette command is implemented
// ---------------------------------------------------------------------------

describe('manifest consistency: declared commands are implemented', () => {
    it('every contributes.commands entry has a registerCommand in code', () => {
        const missing = [...declaredCommands].filter((c) => !registeredInCode.has(c)).sort();
        expect(missing, `Declared but never registered:\n  ${missing.join('\n  ')}`).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Settings read in code -> (section, key) pairs
// ---------------------------------------------------------------------------

interface SettingRead {
    prop: string; // property passed to .get/.update/.inspect/.has (may be dotted)
    section: string; // section resolved via nearest-preceding getConfiguration
    fileSections: string[]; // all getConfiguration sections literally in the file
    file: string;
    line: number;
}

function lineOf(src: string, index: number): number {
    let line = 1;
    for (let i = 0; i < index; i++) if (src[i] === '\n') line++;
    return line;
}

function collectSettingReads(): SettingRead[] {
    const reads: SettingRead[] = [];
    const cfgLiteral = /getConfiguration\(\s*(?:'([^']*)'|"([^"]*)")?\s*(?:,[^)]*)?\)/g;

    for (const [file, src] of fileContents) {
        const fileSectionsSet = new Set<string>();
        let cm: RegExpExecArray | null;
        cfgLiteral.lastIndex = 0;
        while ((cm = cfgLiteral.exec(src))) {
            const section = cm[1] ?? cm[2] ?? '';
            if (section) fileSectionsSet.add(section);
        }
        if (fileSectionsSet.size === 0) continue;
        const fileSections = [...fileSectionsSet];

        // Per-variable declarations: `const cfg = getConfiguration('section')`.
        // A variable name may be re-declared with different sections across
        // functions (the classic `const config = ...` reuse), so resolve each
        // use to the nearest-preceding declaration *of that same name*.
        const declsByVar = new Map<string, { index: number; section: string }[]>();
        const declRe =
            /(?:const|let|var)\s+(\w+)\s*=\s*(?:vscode\.)?workspace\.getConfiguration\(\s*(?:'([^']*)'|"([^"]*)")?\s*(?:,[^)]*)?\)/g;
        let dm: RegExpExecArray | null;
        while ((dm = declRe.exec(src))) {
            const arr = declsByVar.get(dm[1]) ?? [];
            arr.push({ index: dm.index, section: dm[2] ?? dm[3] ?? '' });
            declsByVar.set(dm[1], arr);
        }

        const sectionForVar = (varName: string, useIndex: number): string | null => {
            const decls = declsByVar.get(varName);
            if (!decls) return null;
            let best: string | null = null;
            for (const d of decls) {
                if (d.index <= useIndex) best = d.section;
            }
            return best;
        };

        // Chained: getConfiguration('section').get('prop')
        const chainRe =
            /getConfiguration\(\s*(?:'([^']*)'|"([^"]*)")?\s*(?:,[^)]*)?\)\s*\.\s*(?:get|update|inspect|has)\s*(?:<[^>]*>)?\(\s*(?:'([^']+)'|"([^"]+)")/g;
        while ((cm = chainRe.exec(src))) {
            const section = cm[1] ?? cm[2] ?? '';
            const prop = cm[3] ?? cm[4];
            reads.push({ prop, section, fileSections, file, line: lineOf(src, cm.index) });
        }

        // Variable: cfg.get('prop') where cfg came from getConfiguration.
        const varUseRe = /\b(\w+)\.(?:get|update|inspect|has)\s*(?:<[^>]*>)?\(\s*(?:'([^']+)'|"([^"]+)")/g;
        let vm: RegExpExecArray | null;
        while ((vm = varUseRe.exec(src))) {
            const varName = vm[1];
            const section = sectionForVar(varName, vm.index);
            if (section === null) continue; // not a config variable
            const before = src.slice(Math.max(0, vm.index - 20), vm.index);
            if (/getConfiguration\([^)]*\)\s*\.?\s*$/.test(before)) continue; // chained, already caught
            const prop = vm[2] ?? vm[3];
            reads.push({ prop, section, fileSections, file, line: lineOf(src, vm.index) });
        }
    }
    return reads;
}

const settingReads = collectSettingReads();

// ---------------------------------------------------------------------------
// Rule 3: every scimax.* setting read in code is registered
// ---------------------------------------------------------------------------

describe('manifest consistency: settings read are registered', () => {
    it('every scimax.* configuration key read in code is declared in package.json', () => {
        const seen = new Set<string>();
        const violations: string[] = [];
        for (const r of settingReads) {
            // Resolve the full key from the read's section (nearest-preceding
            // getConfiguration) and property:
            //  - root getConfiguration().get('a.b.c') -> the full key 'a.b.c'
            //  - getConfiguration('scimax.x').get('y') -> 'scimax.x.y'
            //  - non-scimax section (workbench.*, editor.*) -> not our concern
            let key: string;
            if (r.section === '') {
                key = r.prop; // full key passed to root getConfiguration
            } else if (r.section.startsWith('scimax')) {
                key = `${r.section}.${r.prop}`;
            } else {
                continue; // non-scimax section
            }
            if (!key.startsWith('scimax')) continue;
            if (registeredSettings.has(key)) continue;
            const id = `${key}|${r.file}:${r.line}`;
            if (seen.has(id)) continue;
            seen.add(id);
            violations.push(`${key}  (${rel(r.file)}:${r.line})`);
        }
        expect(violations, `Unregistered settings read in code:\n  ${violations.join('\n  ')}`).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Rule 4: every registered setting is read somewhere, in the CLI, or deprecated
// ---------------------------------------------------------------------------

describe('manifest consistency: registered settings are used', () => {
    it('every registered setting is read by the extension/CLI or marked deprecated', () => {
        // A setting `scimax.a.b.c` may be read either as a full-key literal
        // (CLI getSetting, dynamic reads) or split across a
        // getConfiguration('scimax.a') + .get('b.c') pair. Check every split
        // point: some single file must contain the section literal AND the
        // remaining-property literal. This mirrors the accurate audit and
        // avoids the false positives of pure variable-tracking.
        const hasSplitRead = (key: string): boolean => {
            if (allSrc.includes(`'${key}'`) || allSrc.includes(`"${key}"`)) return true;
            const parts = key.split('.');
            for (let i = 1; i < parts.length; i++) {
                const section = parts.slice(0, i).join('.');
                const prop = parts.slice(i).join('.');
                const secLit = `getConfiguration('${section}')`;
                const secLit2 = `getConfiguration("${section}")`;
                const propLit = `'${prop}'`;
                const propLit2 = `"${prop}"`;
                for (const src of fileContents.values()) {
                    if (
                        (src.includes(secLit) || src.includes(secLit2)) &&
                        (src.includes(propLit) || src.includes(propLit2))
                    ) {
                        return true;
                    }
                }
            }
            return false;
        };

        const violations: string[] = [];
        for (const key of [...registeredSettings].sort()) {
            if (deprecatedSettings.has(key)) continue;
            if (hasSplitRead(key)) continue;
            violations.push(key);
        }
        expect(
            violations,
            `Registered settings never read and not deprecated:\n  ${violations.join('\n  ')}`,
        ).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Rule 5: when-clause scimax tokens resolve to a context/view/config key
// ---------------------------------------------------------------------------

describe('manifest consistency: when-clause contexts exist', () => {
    it('every scimax.* token in a when clause is a setContext key, view id, or config key', () => {
        // Context keys set via commands.executeCommand('setContext', 'key', ...)
        const setContextKeys = new Set<string>();
        const scRe = /setContext'\s*,\s*'([^']+)'|setContext"\s*,\s*"([^"]+)"/g;
        let sm: RegExpExecArray | null;
        while ((sm = scRe.exec(allSrc))) setContextKeys.add(sm[1] ?? sm[2]);

        const whens: string[] = [];
        for (const kb of contributes.keybindings ?? []) if (kb.when) whens.push(kb.when);
        for (const items of Object.values<any>(contributes.menus ?? {})) {
            for (const it of items) if (it.when) whens.push(it.when);
        }
        for (const vw of contributes.viewsWelcome ?? []) if (vw.when) whens.push(vw.when);

        const violations = new Set<string>();
        for (const w of whens) {
            for (const tok of w.match(/[A-Za-z_][\w.]*/g) ?? []) {
                if (!tok.startsWith('scimax')) continue;
                // `view == scimax.agenda` style uses view ids; `config.scimax.x` uses config keys.
                if (setContextKeys.has(tok)) continue;
                if (viewIds.has(tok)) continue;
                if (tok.startsWith('config.') && registeredSettings.has(tok.slice('config.'.length))) continue;
                if (registeredSettings.has(tok)) continue;
                violations.add(tok);
            }
        }
        expect(
            [...violations].sort(),
            `when-clause tokens with no matching context/view/config:\n  ${[...violations].join('\n  ')}`,
        ).toEqual([]);
    });
});
