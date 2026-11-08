/**
 * Markdown export backend.
 *
 * Citations (org-ref cite links and org-cite [cite:@key]) are written as
 * Pandoc citations: `[@a; @b]`, `@a` for textual ones, `[-@a]` for year
 * only, with prefixes and page suffixes (`[see @a, p. 5]`). The document's
 * bibliography files and #+CSL_STYLE go in YAML front matter, so
 * `pandoc --citeproc` formats the citations and adds the reference list.
 */

import { parseOrgFast } from './orgExportParser';
import { parseCitationsFromLine, getNormalizedStyle } from '../references/citationParser';
import { ALL_CITATION_COMMANDS } from '../references/citationTypes';

export const CITATION_LINK_TYPES = new Set(ALL_CITATION_COMMANDS.map(c => c.toLowerCase()));
export const BIBLIOGRAPHY_LINK_TYPES = new Set(['bibliography', 'bibliographystyle', 'bibstyle', 'printbibliography', 'nobibliography']);

type CiteStyle = 'textual' | 'parenthetical' | 'author' | 'year';

export interface PandocReference {
    key: string;
    prefix?: string;
    suffix?: string;
}

function suffixText(suffix: string | undefined): string {
    const s = suffix?.trim();
    if (!s) return '';
    return /^[,;]/.test(s) ? s : `, ${s}`;
}

/** A citation in Pandoc's syntax. */
export function pandocCitation(
    refs: PandocReference[],
    style: CiteStyle,
    commonPrefix?: string,
    commonSuffix?: string
): string {
    if (refs.length === 0) return '';
    if (style === 'textual' || style === 'author') {
        // @a [p. 5]; Pandoc has no author-only form, so these are textual.
        return refs.map(r => {
            const loc = r.suffix?.trim().replace(/^,\s*/, '');
            return `@${r.key}${loc ? ` [${loc}]` : ''}`;
        }).join('; ');
    }
    const items = refs.map((r, i) => {
        const pre = [i === 0 ? commonPrefix?.trim() : '', r.prefix?.trim()].filter(Boolean).join(' ');
        const suf = i === refs.length - 1
            ? [r.suffix?.trim(), commonSuffix?.trim()].filter(Boolean).join(' ')
            : r.suffix;
        return `${pre ? `${pre} ` : ''}${style === 'year' ? '-' : ''}@${r.key}${suffixText(suf)}`;
    });
    return `[${items.join('; ')}]`;
}

/** An org-ref cite link (`cite:&a;&b`, `citet:a,b`) as a Pandoc citation. */
export function pandocCitationLink(command: string, linkPath: string): string {
    const parsed = parseCitationsFromLine(`[[${command}:${linkPath}]]`);
    if (parsed.length === 0 || parsed[0].references.length === 0) {
        const keys = linkPath.split(/[,;]/).map(k => k.trim().replace(/^[&@]/, '')).filter(Boolean);
        return pandocCitation(keys.map(key => ({ key })), 'parenthetical');
    }
    const citation = parsed[0];
    const normalized = getNormalizedStyle(citation);
    const style: CiteStyle = normalized === 'numeric' ? 'parenthetical' : normalized;
    return pandocCitation(citation.references, style, citation.commonPrefix, citation.commonSuffix);
}

/** An org-cite citation object (`[cite/t:@a]`) as a Pandoc citation. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pandocCitationObject(p: any): string {
    const refs: PandocReference[] = p.references?.length
        ? p.references
        : (p.keys || []).map((key: string) => ({ key }));
    if (refs.length === 0) return p.rawValue || '';
    const style: CiteStyle = p.style === 't' || p.style === 'text' ? 'textual'
        : p.style === 'na' || p.style === 'noauthor' ? 'year'
            : 'parenthetical';
    return pandocCitation(refs, style, p.prefix, p.suffix);
}

function yamlString(s: string): string {
    return /^[\w./~-]+$/.test(s) ? s : JSON.stringify(s);
}

export function exportToMarkdown(content: string): string {
    const doc = parseOrgFast(content);
    const lines: string[] = [];
    const bibliographies: string[] = [];

    const addBibliography = (paths: string) => {
        for (let p of paths.split(',').map(x => x.trim()).filter(Boolean)) {
            if (!/\.(bib|json|ya?ml|ris)$/i.test(p)) p += '.bib';
            if (!bibliographies.includes(p)) bibliographies.push(p);
        }
    };
    for (const value of doc.keywordLists?.['BIBLIOGRAPHY'] ?? (doc.keywords?.['BIBLIOGRAPHY'] ? [doc.keywords['BIBLIOGRAPHY']] : [])) {
        addBibliography(value.trim().split(/\s+/)[0]);
    }

    const title = doc.keywords?.['TITLE'];
    const author = doc.keywords?.['AUTHOR'];
    if (title) lines.push(`# ${title}`, '');
    if (author) lines.push(`*${author}*`, '');

    function convertElement(elem: any): void {
        switch (elem.type) {
            case 'headline': {
                const level = elem.properties?.level || 1;
                const headTitle = elem.properties?.rawValue || '';
                lines.push(`${'#'.repeat(level)} ${headTitle}`);
                for (const child of elem.section?.children || []) convertElement(child);
                for (const child of elem.children || []) convertElement(child);
                break;
            }

            case 'section':
                for (const child of elem.children || []) convertElement(child);
                break;

            case 'paragraph': {
                const text = convertObjects(elem.children || []);
                // A paragraph that was only a bibliography: link disappears.
                if (text.trim() || !(elem.children || []).some((o: any) => o.type === 'link')) {
                    lines.push(text, '');
                }
                break;
            }

            case 'src-block':
                lines.push('```' + (elem.properties?.language || ''));
                lines.push(elem.properties?.value || '');
                lines.push('```', '');
                break;

            case 'example-block':
                lines.push('```');
                lines.push(elem.properties?.value || '');
                lines.push('```', '');
                break;

            case 'quote-block':
                for (const child of elem.children || []) {
                    if (child.type === 'paragraph') {
                        lines.push(`> ${convertObjects(child.children || [])}`, '');
                    }
                }
                break;

            case 'plain-list':
                if (elem.children) {
                    for (const item of elem.children) {
                        if (item.type === 'item') {
                            const bullet = elem.properties?.listType === 'ordered' ? '1.' : '-';
                            lines.push(`${bullet} ${convertObjects(item.children?.[0]?.children || [])}`);
                        }
                    }
                    lines.push('');
                }
                break;

            case 'table': {
                const tableRows: string[][] = [];
                for (const row of elem.children || []) {
                    if (row.type === 'table-row' && row.properties?.rowType === 'standard') {
                        tableRows.push((row.children || []).map((cell: any) => convertObjects(cell.children || []).trim()));
                    }
                }
                if (tableRows.length > 0) {
                    const colCount = Math.max(...tableRows.map(r => r.length));
                    const colWidths: number[] = [];
                    for (let col = 0; col < colCount; col++) {
                        colWidths.push(Math.max(3, ...tableRows.map(row => (row[col] || '').length)));
                    }
                    lines.push(`| ${tableRows[0].map((cell, i) => cell.padEnd(colWidths[i])).join(' | ')} |`);
                    lines.push(`| ${colWidths.map(w => '-'.repeat(w)).join(' | ')} |`);
                    for (let i = 1; i < tableRows.length; i++) {
                        lines.push(`| ${tableRows[i].map((cell, j) => (cell || '').padEnd(colWidths[j] || 3)).join(' | ')} |`);
                    }
                    lines.push('');
                }
                break;
            }

            case 'horizontal-rule':
                lines.push('---', '');
                break;
        }
    }

    function convertObjects(objects: any[]): string {
        return objects.map((obj: any) => {
            switch (obj.type) {
                case 'plain-text':
                    return obj.properties?.value || '';
                case 'bold':
                    return `**${convertObjects(obj.children || [])}**`;
                case 'italic':
                    return `*${convertObjects(obj.children || [])}*`;
                case 'underline':
                    return `_${convertObjects(obj.children || [])}_`;
                case 'strike-through':
                    return `~~${convertObjects(obj.children || [])}~~`;
                case 'code':
                case 'verbatim':
                    return `\`${obj.properties?.value || ''}\``;
                case 'citation':
                    return pandocCitationObject(obj.properties || {});
                case 'link': {
                    const linkType = String(obj.properties?.linkType || '').toLowerCase();
                    const url = obj.properties?.path || '';
                    if (CITATION_LINK_TYPES.has(linkType)) return pandocCitationLink(linkType, url);
                    if (BIBLIOGRAPHY_LINK_TYPES.has(linkType)) {
                        if (linkType === 'bibliography' || linkType === 'nobibliography') addBibliography(url);
                        return '';
                    }
                    const desc = obj.children?.[0]?.properties?.value || url;
                    return `[${desc}](${url})`;
                }
                default:
                    return obj.properties?.value || '';
            }
        }).join('');
    }

    // Text before the first heading is in the document's own section.
    if (doc.section) convertElement(doc.section);
    for (const child of doc.children || []) convertElement(child);

    // Pandoc reads the bibliography from YAML front matter.
    if (bibliographies.length > 0) {
        while (lines.length && lines[lines.length - 1] === '') lines.pop();
        const front = ['---'];
        front.push(bibliographies.length === 1
            ? `bibliography: ${yamlString(bibliographies[0])}`
            : `bibliography:\n${bibliographies.map(b => `  - ${yamlString(b)}`).join('\n')}`);
        const csl = doc.keywords?.['CSL_STYLE'];
        if (csl) front.push(`csl: ${yamlString(csl.trim())}`);
        front.push('link-citations: true', '---', '');
        lines.unshift(...front);
        lines.push('');
    }

    return lines.join('\n');
}
