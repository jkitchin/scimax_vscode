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
import { findDrawer } from './dependencyCommands';

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
    let start = -1;
    let level = 0;
    for (let i = Math.min(line, lines.length - 1); i >= 0; i--) {
        const m = lines[i].match(HEADING_RE);
        if (m) {
            start = i;
            level = m[1].length;
            break;
        }
    }
    if (start === -1) return null;

    let end = lines.length - 1;
    for (let i = start + 1; i < lines.length; i++) {
        const m = lines[i].match(HEADING_RE);
        if (m && m[1].length <= level) {
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
 * Subheadings are kept as-is.
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
        body: bodyLines.join('\n'),
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
 * Return the heading's :ID:, adding a fresh UUID in its properties drawer if
 * it has none. Undefined when the edit could not be applied.
 */
async function ensureEmailId(
    document: vscode.TextDocument,
    headingLine: number,
    existing: string | undefined
): Promise<string | undefined> {
    if (existing) return existing;
    const id = randomUUID();
    const drawer = findDrawer(document, headingLine, 'ID');
    const edit = new vscode.WorkspaceEdit();
    if (drawer.start !== -1 && drawer.end !== -1) {
        edit.insert(document.uri, new vscode.Position(drawer.end, 0), `:ID: ${id}\n`);
    } else {
        edit.insert(document.uri, new vscode.Position(drawer.insertAt, 0), `:PROPERTIES:\n:ID: ${id}\n:END:\n`);
    }
    return (await vscode.workspace.applyEdit(edit)) ? id : undefined;
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
        const id = await ensureEmailId(document, email.headingLine, email.id);
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

    const opened = await vscode.env.openExternal(vscode.Uri.parse(url, true));
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
