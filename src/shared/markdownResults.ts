/**
 * Source block results in markdown files.
 *
 * Org writes results as `#+RESULTS:` followed by `: output` lines, which are
 * literal text in markdown. In markdown, results go between two HTML comments
 * (invisible in the preview and in Pandoc output) so a re-run can find and
 * replace them:
 *
 *     <!-- results -->
 *     ```
 *     output
 *     ```
 *     ![](.ob-jupyter/plot.png)
 *     <!-- /results -->
 */

export const MD_RESULTS_OPEN = /^<!--\s*results(?::\s*(.*?))?\s*-->\s*$/i;
export const MD_RESULTS_CLOSE = /^<!--\s*\/results\s*-->\s*$/i;

/**
 * Find the results that follow a code block whose closing fence is on line
 * `blockEnd`. At most one blank line may separate them. Returns the line range
 * of the results, comment markers included.
 */
export function findMarkdownResults(lines: string[], blockEnd: number): { start: number; end: number } | null {
    let i = blockEnd + 1;
    if (i < lines.length && lines[i].trim() === '') i++;
    if (i >= lines.length || !MD_RESULTS_OPEN.test(lines[i])) return null;
    for (let j = i + 1; j < lines.length; j++) {
        if (MD_RESULTS_CLOSE.test(lines[j])) return { start: i, end: j };
        // A new code block or results marker means the close marker is missing
        if (MD_RESULTS_OPEN.test(lines[j])) break;
    }
    return null;
}

/** A backtick fence longer than any backtick run in `text`. */
function fenceFor(text: string): string {
    const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map(run => run.length));
    return '`'.repeat(longest + 1);
}

function codeBlock(text: string, language = ''): string[] {
    const fence = fenceFor(text);
    return [fence + language, text, fence];
}

/** Org table rows as a GFM table; the first row (or the rows above an hline) is the header. */
function gfmTable(rows: string[]): string[] {
    const isHline = (r: string) => /^\s*\|[-+:]+\|?\s*$/.test(r);
    const cells = (r: string) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    const hlineAt = rows.findIndex(isHline);
    const header = hlineAt > 0 ? rows.slice(0, hlineAt) : rows.slice(0, 1);
    const body = (hlineAt > 0 ? rows.slice(hlineAt + 1) : rows.slice(1)).filter(r => !isHline(r));
    const width = Math.max(...[...header, ...body].map(r => cells(r).length));
    const fmt = (c: string[]) => '| ' + Array.from({ length: width }, (_, k) => c[k] ?? '').join(' | ') + ' |';
    return [
        fmt(cells(header[header.length - 1])),
        '|' + Array.from({ length: width }, () => '---').join('|') + '|',
        ...body.map(r => fmt(cells(r))),
    ];
}

/**
 * Convert org results text (as produced by formatResult) into markdown
 * results wrapped in the results comment markers.
 */
export function orgResultsToMarkdown(orgResults: string): string {
    const lines = orgResults.split('\n');
    const header = lines[0].match(/^#\+RESULTS(?:\[[^\]]*\])?:\s*(.*)$/i);
    const name = header?.[1]?.trim();
    const body = header ? lines.slice(1) : lines;
    const out: string[] = [name ? `<!-- results: ${name} -->` : '<!-- results -->'];

    let i = 0;
    while (i < body.length) {
        const line = body[i];

        // Verbatim `: text` lines -> one code block
        if (/^:( |$)/.test(line)) {
            const text: string[] = [];
            while (i < body.length && /^:( |$)/.test(body[i])) {
                text.push(body[i].replace(/^: ?/, ''));
                i++;
            }
            out.push(...codeBlock(text.join('\n')));
            continue;
        }

        // #+BEGIN_X ... #+END_X
        const begin = line.match(/^#\+BEGIN_(\w+)(?:\s+(\S+))?/i);
        if (begin) {
            const kind = begin[1].toLowerCase();
            const end = new RegExp(`^#\\+END_${begin[1]}\\b`, 'i');
            const text: string[] = [];
            i++;
            while (i < body.length && !end.test(body[i])) {
                text.push(body[i]);
                i++;
            }
            i++; // skip #+END_
            if (kind === 'export' && begin[2]?.toLowerCase() === 'html') {
                out.push(...text);          // raw HTML is valid markdown
            } else if (kind === 'export' && begin[2]?.toLowerCase() === 'latex') {
                out.push(...codeBlock(text.join('\n'), '{=latex}'));
            } else if (kind === 'src') {
                out.push(...codeBlock(text.join('\n'), begin[2] ?? ''));
            } else {
                out.push(...codeBlock(text.join('\n')));
            }
            continue;
        }

        // Org tables -> GFM tables
        if (/^\s*\|/.test(line)) {
            const rows: string[] = [];
            while (i < body.length && /^\s*\|/.test(body[i])) {
                rows.push(body[i]);
                i++;
            }
            out.push(...gfmTable(rows));
            continue;
        }

        // [[file:x.png]] / [[file:x][desc]] -> images for image files, links otherwise
        const fileLink = line.match(/^\s*\[\[(?:file:)?([^\]]+)\](?:\[([^\]]*)\])?\]\s*$/);
        if (fileLink) {
            const target = /[\s()]/.test(fileLink[1]) ? `<${fileLink[1]}>` : fileLink[1];
            const isImage = /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(fileLink[1]);
            out.push(`${isImage ? '!' : ''}[${fileLink[2] ?? ''}](${target})`);
            i++;
            continue;
        }

        // Drawer markers from :results drawer
        if (/^:(RESULTS|END):\s*$/i.test(line)) {
            i++;
            continue;
        }

        out.push(line);
        i++;
    }

    out.push('<!-- /results -->');
    return out.join('\n');
}
