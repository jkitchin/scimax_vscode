/**
 * Email an org heading (scimax `email-heading` style).
 *
 * With the cursor anywhere in a heading, compose an email whose subject is the
 * headline text and whose body is the heading's content. Recipients come from
 * the heading's TO, CC and BCC properties (MAIL_TO, MAIL_CC and MAIL_BCC are
 * accepted too, as in org-mime). A SUBJECT / MAIL_SUBJECT property overrides
 * the headline as subject.
 *
 * The compose window opens in Gmail by default, or in the system mail client
 * via a mailto: link (setting `scimax.emailHeading.client`).
 */

import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { getTodoStatesFromText, extractHeadingTitle } from './todoStates';
import { ensureHeadingId } from './dependencyCommands';

export interface HeadingEmail {
    /** Line of the headline in the source text (0-based). */
    headingLine: number;
    /** The heading's :ID: property, if it has one (without an `id:` prefix). */
    id?: string;
    subject: string;
    body: string;
    to: string;
    cc: string;
    bcc: string;
}

/**
 * Longest compose URL we will hand to the browser. Gmail and browsers start
 * failing (HTTP 400 / truncation) somewhere above this; past it the body is
 * copied to the clipboard instead of being put in the URL.
 */
export const MAX_COMPOSE_URL_LENGTH = 8000;

const HEADING_RE = /^(\*+)\s/;
const PLANNING_RE = /^\s*(SCHEDULED|DEADLINE|CLOSED):/;

/**
 * Find the heading containing `line`: returns its start line, the last line
 * of its subtree, and its level; null when the line is before any heading.
 */
export function findHeadingAt(
    lines: string[],
    line: number
): { start: number; end: number; level: number } | null {
    // A `* ` line inside a #+BEGIN_... / #+END_... block is block content
    // (an org example, a shell comment), not a heading.
    const inBlock: boolean[] = new Array(lines.length).fill(false);
    let open: string | null = null;
    for (let i = 0; i < lines.length; i++) {
        if (open) {
            inBlock[i] = true;
            const end = lines[i].match(/^\s*#\+end_(\S+)/i);
            if (end && end[1].toLowerCase() === open) open = null;
        } else {
            const begin = lines[i].match(/^\s*#\+begin_(\S+)/i);
            if (begin) open = begin[1].toLowerCase();
        }
    }
    const headingLevel = (i: number): number => {
        if (inBlock[i]) return 0;
        const m = lines[i].match(HEADING_RE);
        return m ? m[1].length : 0;
    };

    let start = -1;
    let level = 0;
    for (let i = Math.min(line, lines.length - 1); i >= 0; i--) {
        const l = headingLevel(i);
        if (l) {
            start = i;
            level = l;
            break;
        }
    }
    if (start === -1) return null;

    let end = lines.length - 1;
    for (let i = start + 1; i < lines.length; i++) {
        const l = headingLevel(i);
        if (l && l <= level) {
            end = i - 1;
            break;
        }
    }
    return { start, end, level };
}

/** Replace org links with their description (or the bare target). */
function plainLinks(text: string): string {
    return text
        .replace(/\[\[([^\]]+)\]\[([^\]]+)\]\]/g, '$2')
        .replace(/\[\[([^\]]+)\]\]/g, '$1');
}

const WEB_LINK_RE = /^(https?|mailto|doi):/i;

/**
 * Org links in the body as plain text: a web link keeps its address,
 * `[[https://x.org][X]]` -> `X (https://x.org)`; other links (file:, id:,
 * internal) become their description, or the target's last path component,
 * so no local path goes in the email.
 */
export function plainBodyLinks(text: string): string {
    return text.replace(/\[\[([^\]]+)\](?:\[([^\]]+)\])?\]/g, (_m, target: string, desc?: string) => {
        if (WEB_LINK_RE.test(target)) {
            const address = target.replace(/^mailto:/i, '');
            return desc && desc !== target ? `${desc} (${address})` : address;
        }
        if (desc) return desc;
        const bare = target.replace(/^[a-z][\w+-]*:/i, '').replace(/::.*$/, '');
        return bare.split(/[\\/]/).filter(Boolean).pop() ?? bare;
    });
}

/**
 * Normalize an address property to a comma-separated list. Only commas and
 * semicolons separate addresses, since names like "Jane Doe <jane@x.org>"
 * contain spaces.
 */
export function normalizeAddresses(value: string | undefined): string {
    if (!value) return '';
    return value
        .split(/[,;]/)
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .join(', ');
}

/**
 * Build the email for the heading that contains `cursorLine` in `text`.
 * Returns null when the cursor is not inside a heading.
 *
 * The body is the heading's full subtree minus the headline itself, its
 * planning line (SCHEDULED/DEADLINE/CLOSED) and its properties drawer.
 * Subheadings are kept as-is; org links become plain text (plainBodyLinks).
 */
export function buildHeadingEmail(text: string, cursorLine: number): HeadingEmail | null {
    const lines = text.split(/\r?\n/);
    const heading = findHeadingAt(lines, cursorLine);
    if (!heading) return null;

    const todoStates = getTodoStatesFromText(text);
    let subject = plainLinks(extractHeadingTitle(lines[heading.start], todoStates));

    let i = heading.start + 1;
    // Planning line(s) directly under the headline
    while (i <= heading.end && PLANNING_RE.test(lines[i])) i++;

    // Properties drawer
    const props: Record<string, string> = {};
    if (i <= heading.end && /^\s*:PROPERTIES:\s*$/i.test(lines[i])) {
        let j = i + 1;
        while (j <= heading.end && !/^\s*:END:\s*$/i.test(lines[j])) {
            const m = lines[j].match(/^\s*:([^:\s]+):\s*(.*?)\s*$/);
            if (m) props[m[1].toUpperCase()] = m[2];
            j++;
        }
        if (j <= heading.end) i = j + 1; // skip past :END:
    }

    const prop = (...names: string[]): string | undefined => {
        for (const n of names) {
            if (props[n]) return props[n];
        }
        return undefined;
    };

    const subjectProp = prop('SUBJECT', 'MAIL_SUBJECT');
    if (subjectProp) subject = subjectProp;

    const bodyLines = lines.slice(i, heading.end + 1);
    // Trim leading and trailing blank lines
    while (bodyLines.length && bodyLines[0].trim() === '') bodyLines.shift();
    while (bodyLines.length && bodyLines[bodyLines.length - 1].trim() === '') bodyLines.pop();

    const id = prop('ID')?.replace(/^id:/i, '');

    return {
        headingLine: heading.start,
        id: id || undefined,
        subject,
        body: plainBodyLinks(bodyLines.join('\n')),
        to: normalizeAddresses(prop('TO', 'MAIL_TO')),
        cc: normalizeAddresses(prop('CC', 'MAIL_CC')),
        bcc: normalizeAddresses(prop('BCC', 'MAIL_BCC')),
    };
}

/**
 * Append the heading's ID to the body so the sent email can be traced back to
 * its heading later (`Scimax: Go to Heading by ID`, or an `[[id:...]]` link).
 * Only the ID goes in the email: no file name or path.
 */
export function appendIdFooter(body: string, id: string): string {
    const footer = `--\norg-id: ${id}`;
    return body ? `${body}\n\n${footer}` : footer;
}

/**
 * Gmail web compose URL. `account` (an address or account index) selects
 * which signed-in Google account composes the message.
 */
export function buildGmailUrl(email: HeadingEmail, account?: string): string {
    const params: string[] = ['view=cm', 'fs=1'];
    const add = (key: string, value: string) => {
        if (value) params.push(`${key}=${encodeURIComponent(value)}`);
    };
    add('to', email.to);
    add('cc', email.cc);
    add('bcc', email.bcc);
    add('su', email.subject);
    add('body', email.body);
    add('authuser', account ?? '');
    return `https://mail.google.com/mail/?${params.join('&')}`;
}

/** RFC 6068 mailto: URL for the system mail client. */
export function buildMailtoUrl(email: HeadingEmail): string {
    const params: string[] = [];
    const add = (key: string, value: string) => {
        if (value) params.push(`${key}=${encodeURIComponent(value)}`);
    };
    add('cc', email.cc);
    add('bcc', email.bcc);
    add('subject', email.subject);
    // mailto bodies use CRLF line breaks
    add('body', email.body.replace(/\r?\n/g, '\r\n'));
    const to = email.to
        .split(',')
        .map(s => encodeURIComponent(s.trim()))
        .filter(Boolean)
        .join(',');
    return `mailto:${to}${params.length ? '?' + params.join('&') : ''}`;
}

/**
 * Command: email the heading at point.
 */
export async function emailHeading(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const document = editor.document;
    const email = buildHeadingEmail(document.getText(), editor.selection.active.line);
    if (!email) {
        vscode.window.showWarningMessage('Cursor is not in a heading');
        return;
    }

    const config = vscode.workspace.getConfiguration('scimax.emailHeading');
    if (config.get<boolean>('includeId', true)) {
        const id = email.id ?? await ensureHeadingId(document, email.headingLine, randomUUID);
        if (id) {
            email.body = appendIdFooter(email.body, id);
        } else {
            vscode.window.showWarningMessage('Could not add an ID to the heading; sending without one.');
        }
    }
    const client = config.get<string>('client', 'gmail');
    const account = config.get<string>('gmailAccount', '').trim() || undefined;

    const build = (e: HeadingEmail) =>
        client === 'mailto' ? buildMailtoUrl(e) : buildGmailUrl(e, account);

    let url = build(email);
    let bodyOnClipboard = false;
    if (url.length > MAX_COMPOSE_URL_LENGTH && email.body) {
        // Too long for a URL: open with an empty body and put the body on the clipboard
        await vscode.env.clipboard.writeText(email.body);
        url = build({ ...email, body: '' });
        bodyOnClipboard = true;
    }

    // Pass the URL string, not a Uri: VS Code decodes a Uri's query and
    // re-encodes it, which turns `&` in the subject or body into a parameter
    // separator, `+` into a space and `#` / `?` into %23 / %3F. A string is
    // opened as is (the API is typed Uri but accepts a string).
    const opened = await vscode.env.openExternal(url as unknown as vscode.Uri);
    if (!opened) {
        vscode.window.showErrorMessage('Could not open the email compose window');
        return;
    }
    if (bodyOnClipboard) {
        vscode.window.showInformationMessage(
            'Heading body is too long for a compose link; it was copied to the clipboard. Paste it into the email body.'
        );
    }
}

export function registerEmailHeadingCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.org.emailHeading', emailHeading)
    );
}
