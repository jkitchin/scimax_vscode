/**
 * Composing email: one place that decides where a new email opens.
 *
 * Contacts, mailto: links (org, Markdown, the preview, hovers), Pick Entity and
 * Email Heading all compose through here. `scimax.mail.client` picks Gmail in
 * the browser (the default) or the system mail client via a mailto: link;
 * `scimax.mail.gmailAccount` picks the Google account when you are signed in
 * to several.
 */
import * as vscode from 'vscode';
import { splitAddresses } from './addressList';
import { buildGmailUrl, buildMailtoUrl, MailFields, MAX_COMPOSE_URL_LENGTH } from './emailHeading';

export type MailClient = 'gmail' | 'mailto';

export interface MailSettings {
    client: MailClient;
    /** Gmail account (address or index) passed as authuser; undefined for the default. */
    account?: string;
}

const EMPTY: MailFields = { to: '', cc: '', bcc: '', subject: '', body: '' };

/**
 * The mail settings. `scimax.mail.*` wins; a value set only under the older
 * `scimax.emailHeading.client` / `gmailAccount` is still honored.
 */
export function mailSettings(resource: vscode.Uri | undefined = vscode.window.activeTextEditor?.document.uri): MailSettings {
    // Scoped to the file (the active editor's by default), so folder settings count.
    const explicit = <T>(fullKey: string): T | undefined => {
        const dot = fullKey.lastIndexOf('.');
        const info = vscode.workspace.getConfiguration(fullKey.slice(0, dot), resource).inspect<T>(fullKey.slice(dot + 1));
        return info?.workspaceFolderValue ?? info?.workspaceValue ?? info?.globalValue;
    };
    const client = explicit<string>('scimax.mail.client')
        ?? explicit<string>('scimax.emailHeading.client')
        ?? 'gmail';
    const account = (explicit<string>('scimax.mail.gmailAccount')
        ?? explicit<string>('scimax.emailHeading.gmailAccount')
        ?? '').trim();
    return { client: client === 'mailto' ? 'mailto' : 'gmail', account: account || undefined };
}

/** The compose URL for `fields` with the given settings. */
export function composeUrl(fields: Partial<MailFields>, settings: MailSettings): string {
    const email = { ...EMPTY, ...fields };
    return settings.client === 'mailto' ? buildMailtoUrl(email) : buildGmailUrl(email, settings.account);
}

/**
 * Parse a mailto: URL (RFC 6068) into mail fields. Unknown headers are
 * ignored; repeated addresses are joined with ", ".
 */
export function parseMailto(url: string): MailFields {
    const fields: MailFields = { ...EMPTY };
    const rest = url.replace(/^mailto:/i, '');
    const q = rest.indexOf('?');
    // RFC 6068: "+" is a literal plus (me+tag@x.org), not a space; spaces are %20
    const decode = (s: string) => {
        try { return decodeURIComponent(s); } catch { return s; }
    };
    const join = (a: string, b: string) => [a, b].filter(Boolean).join(', ');
    fields.to = splitAddresses(decode(q >= 0 ? rest.slice(0, q) : rest)).join(', ');
    if (q >= 0) {
        for (const pair of rest.slice(q + 1).split('&')) {
            const eq = pair.indexOf('=');
            if (eq < 0) continue;
            const key = pair.slice(0, eq).toLowerCase();
            const value = decode(pair.slice(eq + 1));
            if (key === 'to') fields.to = join(fields.to, value);
            else if (key === 'cc') fields.cc = join(fields.cc, value);
            else if (key === 'bcc') fields.bcc = join(fields.bcc, value);
            else if (key === 'subject') fields.subject = value;
            else if (key === 'body') fields.body = value.replace(/\r\n/g, '\n');
        }
    }
    return fields;
}

/**
 * Open a compose window for `fields` in the configured client. A body too
 * long for a URL goes on the clipboard instead. Returns false if nothing
 * opened.
 */
export async function composeEmail(fields: Partial<MailFields>): Promise<boolean> {
    const settings = mailSettings();
    let url = composeUrl(fields, settings);
    let bodyOnClipboard = false;
    if (url.length > MAX_COMPOSE_URL_LENGTH && fields.body) {
        await vscode.env.clipboard.writeText(fields.body);
        url = composeUrl({ ...fields, body: '' }, settings);
        bodyOnClipboard = true;
    }
    // A string, not a Uri: VS Code would decode and re-encode a Uri's query,
    // turning `&` in a subject into a separator (see emailHeading.ts).
    const opened = await vscode.env.openExternal(url as unknown as vscode.Uri);
    if (!opened) {
        vscode.window.showErrorMessage('Could not open the email compose window');
        return false;
    }
    if (bodyOnClipboard) {
        vscode.window.showInformationMessage('The body is too long for a compose link; it was copied to the clipboard.');
    }
    return true;
}

/** Open a mailto: URL in the configured client. */
export function openMailto(url: string): Promise<boolean> {
    return composeEmail(parseMailto(url));
}

/** A command: URI that composes to `url` (a mailto: URL), for links and hovers. */
export function mailtoCommandUri(url: string): vscode.Uri {
    return vscode.Uri.parse(`command:scimax.mail.compose?${encodeURIComponent(JSON.stringify([url]))}`);
}

/** A mailto: link in Markdown text: `[x](mailto:...)`, `<mailto:...>` or a bare `mailto:...`. */
export interface MarkdownMailtoLink {
    start: number;
    end: number;
    url: string;
}

/**
 * The mailto: links in Markdown text, with the offsets of their URL. Code
 * spans and fenced code are not skipped (a mailto: in code is rare and the
 * link is harmless).
 */
export function findMarkdownMailtoLinks(text: string): MarkdownMailtoLink[] {
    const links: MarkdownMailtoLink[] = [];
    const re = /mailto:[^\s<>()\[\]"'`]+/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        // Trailing sentence punctuation is not part of a bare link
        const url = m[0].replace(/[.,;:!?]+$/, '');
        links.push({ start: m.index, end: m.index + url.length, url });
    }
    return links;
}

/**
 * mailto: links in Markdown compose in the configured client (Gmail by
 * default) instead of going straight to the system mail app.
 */
export class MarkdownMailtoLinkProvider implements vscode.DocumentLinkProvider {
    provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
        return findMarkdownMailtoLinks(document.getText()).map(link => {
            const range = new vscode.Range(document.positionAt(link.start), document.positionAt(link.end));
            const docLink = new vscode.DocumentLink(range, mailtoCommandUri(link.url));
            docLink.tooltip = 'Compose email';
            return docLink;
        });
    }
}

/**
 * markdown-it plugin for the Markdown preview: with Gmail as the client, a
 * mailto: link opens a Gmail compose window (the preview cannot run
 * commands, so the link itself is rewritten).
 */
export function mailtoPreviewPlugin(md: any, getSettings: () => MailSettings = mailSettings): void {
    md.core.ruler.push('scimax_mailto', (state: any) => {
        const settings = getSettings();
        if (settings.client !== 'gmail') return;
        const visit = (tokens: any[]) => {
            for (const token of tokens) {
                if (token.type === 'link_open') {
                    const href: string = token.attrGet('href') ?? '';
                    if (/^mailto:/i.test(href)) token.attrSet('href', composeUrl(parseMailto(href), settings));
                }
                if (token.children) visit(token.children);
            }
        };
        visit(state.tokens);
    });
}

export function registerMailCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        // Arguments: a mailto: URL, or mail fields. With none, asks for an address.
        vscode.commands.registerCommand('scimax.mail.compose', async (arg?: string | Partial<MailFields>) => {
            if (typeof arg === 'string') return openMailto(arg.startsWith('mailto:') ? arg : `mailto:${arg}`);
            if (arg && typeof arg === 'object') return composeEmail(arg);
            const to = await vscode.window.showInputBox({ prompt: 'To', placeHolder: 'name@example.com' });
            if (to === undefined) return false;
            return composeEmail({ to });
        })
    );
}
