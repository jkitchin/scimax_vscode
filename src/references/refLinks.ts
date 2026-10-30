/**
 * org-ref reference links (ref:label, eqref:label, ...) and finding where
 * their labels are defined. Kept free of vscode imports so link providers
 * and tests can use it cheaply.
 */

/**
 * org-ref reference link types: ref:label, eqref:label, ...
 */
export const REF_LINK_TYPES = ['ref', 'eqref', 'pageref', 'nameref', 'autoref', 'cref', 'Cref'];

/**
 * Path of a reference written as an org link, e.g. `ref:fig-1` in [[ref:fig-1]].
 */
export const REF_LINK_PATH_RE = new RegExp(`^(${REF_LINK_TYPES.join('|')}):(.+)$`);

export interface BareRef {
    /** Column of the start of the link (the ref type) */
    start: number;
    /** Column just past the label, after trailing punctuation is dropped */
    end: number;
    type: string;
    label: string;
}

/**
 * Find bare org-ref reference links (ref:label, eqref:label, ...) in a line.
 * Labels may contain colons (ref:tab:flows), and trailing sentence
 * punctuation is not part of the label: "see ref:table-data." -> table-data.
 * Links inside [[...]] are left to the bracket link handling.
 */
export function findBareRefs(line: string): BareRef[] {
    const re = new RegExp(`(?<![\\w:[\\\\])(${REF_LINK_TYPES.join('|')}):([^\\s<>[\\](){},|]+)`, 'g');
    const refs: BareRef[] = [];
    let match;
    while ((match = re.exec(line)) !== null) {
        const label = match[2].replace(/[.,;:!?]+$/, '');
        if (!label) continue;
        refs.push({
            start: match.index,
            end: match.index + match[1].length + 1 + label.length,
            type: match[1],
            label
        });
    }
    return refs;
}

function escapeLabelRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the line that defines a label: label:name, \label{name},
 * :CUSTOM_ID: name, #+NAME: name, #+LABEL: name, or <<name>>.
 */
export function findLabelLine(lines: string[], label: string): { line: number; type: string } | null {
    // Patterns are permissive about trailing whitespace and line endings
    const escapedLabel = escapeLabelRegex(label);
    const labelPatterns = [
        // org-ref style: label:name
        { regex: new RegExp(`label:${escapedLabel}(?=[\\s.,;:!?)]|$)`, 'i'), type: 'Label' },
        // LaTeX style: \label{name}
        { regex: new RegExp(`\\\\label\\{${escapedLabel}\\}`, 'i'), type: 'LaTeX Label' },
        // org-mode CUSTOM_ID property
        { regex: new RegExp(`:CUSTOM_ID:\\s*${escapedLabel}(?:\\s|$)`, 'i'), type: 'Heading (CUSTOM_ID)' },
        // org-mode #+NAME: (allows trailing content)
        { regex: new RegExp(`^\\s*#\\+NAME:\\s*${escapedLabel}(?:\\s|$)`, 'i'), type: 'Named Element' },
        // org-mode #+LABEL: (for figures/tables)
        { regex: new RegExp(`^\\s*#\\+LABEL:\\s*${escapedLabel}(?:\\s|$)`, 'i'), type: 'Figure/Table' },
        // org-mode dedicated target: <<name>>
        { regex: new RegExp(`(?<!<)<<${escapedLabel}>>(?!>)`, 'i'), type: 'Target' }
    ];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].replace(/\r$/, '');
        for (const { regex, type } of labelPatterns) {
            if (regex.test(line)) {
                return { line: i, type };
            }
        }
    }
    return null;
}
