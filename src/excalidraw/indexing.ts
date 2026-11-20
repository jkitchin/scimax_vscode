/**
 * What the database indexes from a drawing: the text on its shapes (for
 * full-text search) and its shapes' links as ordinary link rows, so a heading
 * a drawing links to lists the drawing among its back-links and the link
 * graph draws an edge from the drawing.
 */
import * as path from 'path';
import { parseOrgLinkUri, parseSceneFile, sceneLinks } from './scene';

import { DRAWING_FILE_RE } from '../shared/indexableFiles';

export { DRAWING_FILE_RE };

export function isDrawingPath(filePath: string): boolean {
    return DRAWING_FILE_RE.test(filePath);
}

export interface DrawingLinkRow {
    /** Link type as the org parser names it: id, file, nb, https, ... */
    type: string;
    /** Raw target as written after the type prefix for id links, else the whole link */
    target: string;
    /** The shape's label */
    description?: string;
    lineNumber: number;
}

export interface IndexedDrawing {
    /** The shapes' text, one per line, for full-text search */
    text: string;
    links: DrawingLinkRow[];
}

/** One shape link as a link row, or null for links not worth indexing. */
export function drawingLinkRow(href: string, drawingPath: string, label?: string): DrawingLinkRow | null {
    const org = parseOrgLinkUri(href);
    let link = (org?.link ?? href).trim();
    const bracket = link.match(/^\[\[(.+?)\](?:\[.*\])?\]$/s);
    if (bracket) link = bracket[1];
    if (!link) return null;
    const row = (type: string, target: string): DrawingLinkRow => ({ type, target, description: label, lineNumber: 1 });

    if (/^id:/i.test(link)) return row('id', link.slice(3).trim());
    if (/^[*#]/.test(link)) {
        // Relative to the org file it was copied from
        if (!org?.from) return null;
        const from = path.resolve(path.dirname(drawingPath), org.from);
        return row('file', `file:${from}::${link}`);
    }
    const scheme = link.match(/^([a-z][\w+.-]*):/i)?.[1].toLowerCase();
    if (scheme === 'file') return row('file', link);
    if (scheme && scheme.length > 1) return row(scheme, link);
    // A plain path (relative to the drawing), as the Excalidraw editor opens it
    return row('file', link);
}

/** Text and links of a drawing file's content, or null if it holds no scene. */
export function indexDrawing(content: string, drawingPath: string): IndexedDrawing | null {
    const scene = parseSceneFile(content, drawingPath);
    if (!scene) return null;
    const text = scene.elements
        .filter(e => !e.isDeleted && e.type === 'text' && typeof e.text === 'string')
        .map(e => (e.text as string).trim())
        .filter(Boolean)
        .join('\n');
    const links = sceneLinks(scene)
        .map(l => drawingLinkRow(l.link, drawingPath, l.text?.replace(/\s+/g, ' ').trim()))
        .filter((r): r is DrawingLinkRow => r !== null);
    return { text, links };
}
