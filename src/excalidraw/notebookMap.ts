/**
 * A notebook map: an Excalidraw drawing of a notebook's org files.
 *
 * One column per org file (the master file first): a header box linked to
 * the file, then a box per top-level heading linked to that heading. An arrow
 * runs from a heading to every other file or heading its section links to
 * (file:, relative paths, ::*Heading, ::#custom-id and id: links), so the map
 * shows how the notebook hangs together. In Scimax's Excalidraw editor each
 * box opens its heading and shows its TODO state.
 *
 * Pure: takes file contents, returns a scene spec for normalizeScene.
 */
import * as path from 'path';
import { linkForHeading, parseOrgHeadings, type NoteHeading } from './noteIndex';

export interface MapFile {
    path: string;
    content: string;
}

export interface NotebookMapOptions {
    title: string;
    /** Folder the drawing will be saved in; links are relative to it */
    drawingDir: string;
    /** Shown first */
    masterFile?: string;
    maxFiles?: number;
    maxHeadings?: number;
}

const COL_W = 260;
const COL_GAP = 120;
const HEADER_H = 56;
const BOX_H = 52;
const ROW_GAP = 18;
const TOP = 90;

const FILE_COLOR = '#ffec99';
const HEADING_COLOR = '#a5d8ff';
const DONE_COLOR = '#b2f2bb';

type Spec = Record<string, unknown>;

/** Links in a heading's section to other files or headings. */
function sectionLinks(lines: string[], start: number, end: number): Array<{ file?: string; search?: string; id?: string }> {
    const out: Array<{ file?: string; search?: string; id?: string }> = [];
    const re = /\[\[([^\]]+?)\](?:\[[^\]]*\])?\]/g;
    for (let i = start; i < end; i++) {
        for (const m of lines[i].matchAll(re)) {
            const target = m[1].trim();
            if (/^id:/i.test(target)) { out.push({ id: target.slice(3).trim() }); continue; }
            const file = target.replace(/^file:/i, '');
            if (/^[a-z][\w+-]*:/i.test(file) && !/^file:/i.test(target)) continue; // web, cite, ...
            const [p, ...rest] = file.split('::');
            if (!/\.org$/i.test(p)) continue;
            out.push({ file: p, search: rest.join('::').trim() || undefined });
        }
    }
    return out;
}

function short(text: string, max = 48): string {
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/** Scene spec (for normalizeScene) of a notebook's files and how they link. */
export function notebookMapSpec(files: MapFile[], options: NotebookMapOptions): { elements: Spec[] } {
    const maxFiles = options.maxFiles ?? 12;
    const maxHeadings = options.maxHeadings ?? 15;
    const ordered = [...files].sort((a, b) =>
        (a.path === options.masterFile ? -1 : b.path === options.masterFile ? 1 : a.path.localeCompare(b.path)));
    const shown = ordered.slice(0, maxFiles);

    const elements: Spec[] = [];
    elements.push({ id: 'title', type: 'text', x: 0, y: 0, text: options.title, fontSize: 32 });
    if (ordered.length > shown.length) {
        elements.push({ id: 'more-files', type: 'text', x: 0, y: 44, fontSize: 16,
            text: `${ordered.length - shown.length} more files not shown` });
    }

    const fileBox = new Map<string, string>();       // file path -> element id
    const headingBox = new Map<string, string>();    // file + '\0' + title -> element id
    const idBox = new Map<string, string>();         // :ID: -> element id
    const customBox = new Map<string, string>();     // file + '\0#' + custom id -> element id
    const pending: Array<{ from: string; fromFile: string; link: { file?: string; search?: string; id?: string } }> = [];

    shown.forEach((file, col) => {
        const x = col * (COL_W + COL_GAP);
        const fid = `file-${col}`;
        fileBox.set(path.resolve(file.path), fid);
        const rel = path.relative(options.drawingDir, file.path).split(path.sep).join('/');
        elements.push({
            id: fid, type: 'rectangle', x, y: TOP, width: COL_W, height: HEADER_H,
            backgroundColor: FILE_COLOR, fillStyle: 'solid', strokeWidth: 2,
            label: short(path.basename(file.path), 32), orgLink: `file:${rel}`,
        });

        const lines = file.content.split(/\r?\n/);
        const all = parseOrgHeadings(file.content, file.path);
        const top = all.filter(h => h.level === Math.min(...all.map(x => x.level)));
        top.slice(0, maxHeadings).forEach((h: NoteHeading, row) => {
            const hid = `h-${col}-${row}`;
            const y = TOP + HEADER_H + ROW_GAP + row * (BOX_H + ROW_GAP);
            elements.push({
                id: hid, type: 'rectangle', x: x + 16, y, width: COL_W - 16, height: BOX_H,
                backgroundColor: h.done ? DONE_COLOR : HEADING_COLOR, fillStyle: 'solid',
                roundness: { type: 3 },
                label: short(`${h.todo ? h.todo + ' ' : ''}${h.title}`),
                orgLink: linkForHeading(h, options.drawingDir),
            });
            headingBox.set(path.resolve(file.path) + '\0' + h.title, hid);
            if (h.id) idBox.set(h.id, hid);
            if (h.customId) customBox.set(path.resolve(file.path) + '\0#' + h.customId, hid);

            // The section runs to the next heading of the same or a higher level
            const next = all.find(x => x.line > h.line && x.level <= h.level);
            for (const link of sectionLinks(lines, h.line, next ? next.line - 1 : lines.length)) {
                pending.push({ from: hid, fromFile: file.path, link });
            }
        });
        if (top.length > maxHeadings) {
            const y = TOP + HEADER_H + ROW_GAP + maxHeadings * (BOX_H + ROW_GAP);
            elements.push({ id: `more-${col}`, type: 'text', x: x + 16, y, fontSize: 14, text: `${top.length - maxHeadings} more headings` });
        }
    });

    // Arrows between sections and the files / headings they link to
    const seen = new Set<string>();
    for (const { from, fromFile, link } of pending) {
        let to: string | undefined;
        if (link.id) {
            to = idBox.get(link.id);
        } else if (link.file) {
            const file = path.resolve(path.dirname(fromFile), link.file);
            if (link.search?.startsWith('*')) to = headingBox.get(file + '\0' + link.search.slice(1).trim());
            else if (link.search?.startsWith('#')) to = customBox.get(file + '\0' + link.search);
            to = to ?? fileBox.get(file);
        }
        if (!to || to === from) continue;
        const key = `${from}>${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        elements.push({ type: 'arrow', from, to, strokeColor: '#868e96', strokeStyle: 'dashed' });
    }

    return { elements };
}
