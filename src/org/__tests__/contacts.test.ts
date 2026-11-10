import { describe, it, expect, vi, beforeEach } from 'vitest';

const configValues: Record<string, Record<string, unknown>> = {};
vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: (section: string) => ({
            inspect: (key: string) => ({ globalValue: configValues[section]?.[key] }),
        }),
    },
}));
vi.mock('../../database/lazyDb', () => ({ getDatabase: vi.fn() }));
vi.mock('../dependencyCommands', () => ({ ensureHeadingId: vi.fn() }));

import { firstAddress, nameAddress, noteInsertLine, noteLine, stripTags, toContacts } from '../contacts';
import { composeUrl, findMarkdownMailtoLinks, mailSettings, mailtoPreviewPlugin, parseMailto } from '../mail';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MarkdownIt = require('markdown-it');
import type { HeadingRecord } from '../../database/scimaxDbCore';

function row(title: string, props: Record<string, string>, tags: string[] = [], line = 1, file = '/n/people.org'): HeadingRecord {
    return { title, properties: JSON.stringify(props), tags: JSON.stringify(tags), file_path: file, line_number: line } as unknown as HeadingRecord;
}

describe('contacts helpers', () => {
    it('strips trailing tags from a title', () => {
        expect(stripTags('Ana Ramirez   :person:colleague:')).toBe('Ana Ramirez');
        expect(stripTags('Plain name')).toBe('Plain name');
    });

    it('takes the first address from an EMAIL value', () => {
        expect(firstAddress('a@x.org, b@y.org')).toBe('a@x.org');
        expect(firstAddress('a@x.org b@y.org')).toBe('a@x.org');
        expect(firstAddress('Ana <ana@x.org>')).toBe('ana@x.org');
        expect(firstAddress(undefined)).toBe('');
    });

    it('formats Name <address>, quoting names RFC 5322 would misread', () => {
        expect(nameAddress('Ana Ramirez', 'ana@x.org')).toBe('Ana Ramirez <ana@x.org>');
        expect(nameAddress('Ramirez, Ana', 'ana@x.org')).toBe('"Ramirez, Ana" <ana@x.org>');
        expect(nameAddress('J. "Jo" Doe', 'jo@x.org')).toBe('"J. \\"Jo\\" Doe" <jo@x.org>');
        expect(nameAddress('No Mail', undefined)).toBe('No Mail');
    });

    it('builds contacts from EMAIL headings and person-tagged headings, once each', () => {
        const contacts = toContacts([
            row('Zed', { EMAIL: 'z@x.org' }, [], 10),
            row('Ana :person:', {}, ['person'], 3),
            row('Zed', { EMAIL: 'z@x.org' }, [], 10),
            row('Project', { OWNER: 'me' }, [], 20),
            row('Bo', { email: ' bo@x.org ' }, [], 30),
        ]);
        expect(contacts.map(c => c.name)).toEqual(['Ana', 'Bo', 'Zed']);
        expect(contacts[1].email).toBe('bo@x.org');
        expect(contacts[0].email).toBeUndefined();
    });

    it('puts a note at the end of the heading text, before subheadings', () => {
        const org = ['* Ana', ':PROPERTIES:', ':EMAIL: a@x.org', ':END:', '- old note', '', '** Sub', 'x'];
        expect(noteInsertLine(org, 0, false)).toBe(5);
        const last = ['* Ana', 'text', '', ''];
        expect(noteInsertLine(last, 0, false)).toBe(2);
        expect(noteInsertLine(['* Ana'], 0, false)).toBe(1);
    });

    it('ignores # lines inside Markdown code fences', () => {
        const md = ['## Ana', '```sh', '# comment', '```', '', '## Bo'];
        expect(noteInsertLine(md, 0, true)).toBe(4);
    });

    it('starts a note with an inactive timestamp', () => {
        expect(noteLine(new Date(2026, 10, 9, 14, 5))).toBe('- [2026-11-09 Mon 14:05] ');
    });
});

describe('mail', () => {
    beforeEach(() => { for (const k of Object.keys(configValues)) delete configValues[k]; });

    it('parses mailto URLs', () => {
        expect(parseMailto('mailto:a@x.org,b@y.org?cc=c@z.org&subject=Hi%20there&body=line1%0D%0Aline2')).toEqual({
            to: 'a@x.org, b@y.org', cc: 'c@z.org', bcc: '', subject: 'Hi there', body: 'line1\nline2',
        });
        expect(parseMailto('MAILTO:a@x.org').to).toBe('a@x.org');
        // "+" is literal in mailto (RFC 6068), as in plus addressing
        expect(parseMailto('mailto:me+tag@x.org?subject=1+1%20%3D%202')).toMatchObject({ to: 'me+tag@x.org', subject: '1+1 = 2' });
    });

    it('builds a Gmail compose URL, with the account when set', () => {
        const url = composeUrl({ to: 'a@x.org', subject: 'R&D' }, { client: 'gmail', account: 'me@gmail.com' });
        expect(url.startsWith('https://mail.google.com/mail/?')).toBe(true);
        expect(url).toContain('to=a%40x.org');
        expect(url).toContain('su=R%26D');
        expect(url).toContain('authuser=me%40gmail.com');
    });

    it('builds a mailto URL', () => {
        expect(composeUrl({ to: 'a@x.org', subject: 'Hi' }, { client: 'mailto' })).toBe('mailto:a%40x.org?subject=Hi');
    });

    it('defaults to Gmail and honors the older emailHeading settings', () => {
        expect(mailSettings()).toEqual({ client: 'gmail', account: undefined });
        configValues['scimax.emailHeading'] = { client: 'mailto', gmailAccount: '1' };
        expect(mailSettings()).toEqual({ client: 'mailto', account: '1' });
        configValues['scimax.mail'] = { client: 'gmail' };
        expect(mailSettings()).toEqual({ client: 'gmail', account: '1' });
    });
});

describe('Markdown mailto links', () => {
    it('finds the URL of inline, autolink and bare mailto links', () => {
        const text = 'Mail [Ana](mailto:ana@x.org?subject=Hi), <mailto:bo@y.org> or mailto:cy@z.org.';
        const links = findMarkdownMailtoLinks(text);
        expect(links.map(l => l.url)).toEqual(['mailto:ana@x.org?subject=Hi', 'mailto:bo@y.org', 'mailto:cy@z.org']);
        expect(text.slice(links[0].start, links[0].end)).toBe('mailto:ana@x.org?subject=Hi');
    });

    it('rewrites mailto links in the preview to Gmail compose, only with the Gmail client', () => {
        const gmail = new MarkdownIt().use(mailtoPreviewPlugin, () => ({ client: 'gmail' as const }));
        const html = gmail.render('[Ana](mailto:ana@x.org?subject=Hi)');
        expect(html).toContain('href="https://mail.google.com/mail/?');
        expect(html).toContain('to=ana%40x.org');
        const system = new MarkdownIt().use(mailtoPreviewPlugin, () => ({ client: 'mailto' as const }));
        expect(system.render('[Ana](mailto:ana@x.org)')).toContain('href="mailto:ana@x.org"');
    });
});
