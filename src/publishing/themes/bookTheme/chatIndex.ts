/**
 * Chat Index Generation
 *
 * Splits each published page at its headings and writes the sections to
 * _static/chat-index.json. The "Ask the docs" chat (assets/book-chat.js)
 * searches these sections in the browser and gives the best ones to the
 * model, citing each by its URL.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { PageInfo, PageSection } from '../themeTypes';

/** One searchable piece of the site */
export interface ChatChunk {
    /** Page and anchor, relative to the site root (e.g. "10-export.html#org-build-profiles") */
    url: string;

    /** Page title */
    page: string;

    /** Heading of the section */
    heading: string;

    /** Headings above the section, outermost first */
    path: string[];

    /** Plain text */
    text: string;
}

/** Sections longer than this are split at line breaks */
export const MAX_CHUNK_CHARS = 1500;

/** Status keywords of the docs (#+TODO: ⚠️ 👀 | ✅) left at the start of a heading */
const HEADING_STATUS = /^(?:⚠️|⚠|👀|✅)\s*/u;

/**
 * Org export wraps each heading in <div id="..." class="org-section org-level-N">.
 * The text of a section runs from its heading to the next section's start.
 */
const SECTION_START = /<div id="([^"]+)" class="org-section org-level-(\d+)">\s*<h\d[^>]*>([\s\S]*?)<\/h\d>/g;

/**
 * Split the body HTML of a page at its headings
 */
export function splitSections(html: string): PageSection[] {
    const body = html.replace(/<nav id="table-of-contents"[\s\S]*?<\/nav>/i, '');
    const sections: PageSection[] = [];
    const stack: Array<{ level: number; heading: string }> = [];

    const starts = [...body.matchAll(SECTION_START)];
    const before = htmlToText(body.slice(0, starts.length > 0 ? starts[0].index : body.length));
    if (before) {
        sections.push({ heading: '', path: [], text: before });
    }

    starts.forEach((match, i) => {
        const level = parseInt(match[2], 10);
        const heading = htmlToText(match[3]).replace(/\s+/g, ' ').replace(HEADING_STATUS, '');
        while (stack.length > 0 && stack[stack.length - 1].level >= level) {
            stack.pop();
        }
        const end = i + 1 < starts.length ? starts[i + 1].index : body.length;
        const text = htmlToText(body.slice(match.index + match[0].length, end));
        sections.push({ id: match[1], heading, path: stack.map(s => s.heading), text });
        stack.push({ level, heading });
    });

    return sections;
}

/**
 * Plain text of an HTML fragment, keeping one line per block (paragraph,
 * list item, table row, code line) so long sections can be split sensibly.
 */
export function htmlToText(html: string): string {
    return decodeEntities(html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<\/t[dh]>/gi, ' | ')
        .replace(/<br\s*\/?>|<\/(?:p|li|tr|pre|h\d|div|dt|dd|blockquote|table)>/gi, '\n')
        .replace(/<[^>]+>/g, ' '))
        .split('\n')
        .map(line => line.replace(/[ \t\r\f\v]+/g, ' ').trim())
        .filter(line => line.length > 0)
        .join('\n');
}

function decodeEntities(text: string): string {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&#x27;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
        .replace(/&amp;/g, '&');
}

/**
 * Split text into pieces of at most `max` characters, at line breaks where
 * possible
 */
export function splitText(text: string, max: number = MAX_CHUNK_CHARS): string[] {
    const lines = text.split('\n').flatMap(line => {
        const parts: string[] = [];
        for (let start = 0; start < line.length; start += max) {
            parts.push(line.slice(start, start + max));
        }
        return parts;
    });
    const pieces: string[] = [];
    let current = '';
    for (const line of lines) {
        if (current && current.length + 1 + line.length > max) {
            pieces.push(current);
            current = '';
        }
        current = current ? `${current}\n${line}` : line;
    }
    if (current) {
        pieces.push(current);
    }
    return pieces;
}

/**
 * The chunks of all pages. Sections with no text of their own (a heading
 * followed straight away by a subheading) are left out; their heading is in
 * the path of the sections below them.
 */
export function buildChatChunks(pages: PageInfo[], max: number = MAX_CHUNK_CHARS): ChatChunk[] {
    const chunks: ChatChunk[] = [];
    for (const page of pages) {
        const url = page.path.split(path.sep).join('/');
        for (const section of page.sections ?? []) {
            for (const text of splitText(section.text, max)) {
                chunks.push({
                    url: section.id ? `${url}#${section.id}` : url,
                    page: page.title,
                    heading: section.heading || page.title,
                    path: section.path,
                    text,
                });
            }
        }
    }
    return chunks;
}

/**
 * Write _static/chat-index.json
 */
export async function generateChatIndex(pages: PageInfo[], outputDir: string): Promise<void> {
    const staticDir = path.join(outputDir, '_static');
    await fs.promises.mkdir(staticDir, { recursive: true });
    const index = {
        version: 1,
        built: new Date().toISOString(),
        chunks: buildChatChunks(pages),
    };
    await fs.promises.writeFile(path.join(staticDir, 'chat-index.json'), JSON.stringify(index), 'utf-8');
}
