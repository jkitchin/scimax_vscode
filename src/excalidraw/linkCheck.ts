/**
 * Check that the org links in a drawing point at files, headings and custom
 * ids that exist. `id:`, `cite:` and other links that need the database or
 * the bibliography are not checked.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExcalidrawScene, parseOrgLinkUri, sceneLinks } from './scene';

export interface LinkProblem {
    id: string;
    text?: string;
    link: string;
    problem: string;
}

function expandHome(p: string): string {
    return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

const TODO_RE = /^(TODO|DONE|NEXT|WAITING|HOLD|CANCELLED|CANCELED)\s+/;

/** Heading titles in an org file, without stars, TODO keyword, priority or tags. */
function headingTitles(content: string): Set<string> {
    const titles = new Set<string>();
    for (const line of content.split('\n')) {
        const m = line.match(/^\*+\s+(.*)$/);
        if (!m) continue;
        titles.add(m[1]
            .replace(/\s+:[\w@#%:-]+:\s*$/, '')
            .replace(TODO_RE, '')
            .replace(/^\[#[A-Z0-9]\]\s*/, '')
            .trim());
    }
    return titles;
}

/** Problem with a search option (`*Heading`, `#custom-id`) in `file`, or null. */
function searchProblem(file: string, search: string): string | null {
    let content: string;
    try {
        content = fs.readFileSync(file, 'utf8');
    } catch {
        return `cannot read ${file}`;
    }
    if (search.startsWith('*')) {
        const title = search.slice(1).trim();
        return headingTitles(content).has(title) ? null : `no heading "${title}" in ${file}`;
    }
    if (search.startsWith('#')) {
        const id = search.slice(1).trim();
        const re = new RegExp(`^\\s*:CUSTOM_ID:\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'mi');
        return re.test(content) ? null : `no CUSTOM_ID "${id}" in ${file}`;
    }
    return null;
}

/** Problem with one org link written relative to `baseDir` (or in `fromFile`). */
export function orgLinkProblem(orgLink: string, baseDir: string, fromFile?: string): string | null {
    let link = orgLink.trim();
    const bracket = link.match(/^\[\[(.+?)\](?:\[.*\])?\]$/s);
    if (bracket) link = bracket[1];

    if (/^[*#]/.test(link)) {
        return fromFile ? searchProblem(fromFile, link) : 'a *heading or #id link needs a from= file';
    }
    const isFile = /^file:/i.test(link) || (!/^[a-z][\w+-]*:/i.test(link)
        && (link.includes('/') || link.includes('::') || /\.\w+$/.test(link)));
    if (!isFile) return null;

    const [filePart, ...rest] = link.replace(/^file:/i, '').split('::');
    const file = path.resolve(baseDir, expandHome(filePart));
    if (!fs.existsSync(file)) return `file not found: ${file}`;
    const search = rest.join('::').trim();
    if (!search || /^\d+$/.test(search) || /^c\d+$/.test(search)) return null;
    return searchProblem(file, search);
}

/** Broken org links in a drawing stored at `drawingPath`. */
export function checkSceneLinks(scene: ExcalidrawScene, drawingPath: string): LinkProblem[] {
    const drawingDir = path.dirname(path.resolve(drawingPath));
    const problems: LinkProblem[] = [];
    for (const l of sceneLinks(scene)) {
        const org = parseOrgLinkUri(l.link);
        let problem: string | null = null;
        if (org) {
            const fromFile = org.from ? path.resolve(drawingDir, expandHome(org.from)) : undefined;
            problem = orgLinkProblem(org.link, fromFile ? path.dirname(fromFile) : drawingDir, fromFile);
        } else if (!/^[a-z][\w+.-]*:/i.test(l.link) && !l.link.startsWith('#')) {
            // Plain relative path, opened by the Excalidraw editor itself
            const file = path.resolve(drawingDir, l.link.split('#')[0]);
            if (!fs.existsSync(file)) problem = `file not found: ${file}`;
        }
        if (problem) problems.push({ id: l.id, text: l.text, link: org?.link ?? l.link, problem });
    }
    return problems;
}
