import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({}));
vi.mock('../../database/lazyDb', () => ({ getDatabase: vi.fn() }));

import {
    buildHeadingEmail,
    buildGmailUrl,
    buildMailtoUrl,
    appendIdFooter,
    normalizeAddresses,
    findHeadingAt,
} from '../emailHeading';

const doc = `#+TITLE: Notes

* TODO [#A] Meeting notes for [[https://x.org][project X]] :work:urgent:
SCHEDULED: <2026-11-02 Mon>
:PROPERTIES:
:TO: alice@example.com, Bob Smith <bob@example.com>
:CC: carol@example.com; dave@example.com
:BCC: eve@example.com
:ID: 1234-abcd
:END:

Here are the notes.

- item one
** Sub heading
More text.

* Next heading
other
`;

describe('findHeadingAt', () => {
    it('returns null before the first heading', () => {
        expect(findHeadingAt(doc.split('\n'), 0)).toBeNull();
    });
    it('spans the subtree', () => {
        const lines = doc.split('\n');
        const h = findHeadingAt(lines, 12)!;
        expect(lines[h.start]).toMatch(/^\* TODO/);
        expect(lines[h.end + 1]).toBe('* Next heading');
    });
});

describe('buildHeadingEmail', () => {
    it('extracts subject, body and recipients', () => {
        const email = buildHeadingEmail(doc, 12)!;
        expect(email.subject).toBe('Meeting notes for project X');
        expect(email.to).toBe('alice@example.com, Bob Smith <bob@example.com>');
        expect(email.cc).toBe('carol@example.com, dave@example.com');
        expect(email.bcc).toBe('eve@example.com');
        expect(email.id).toBe('1234-abcd');
        expect(email.headingLine).toBe(2);
        expect(email.body).toBe('Here are the notes.\n\n- item one\n** Sub heading\nMore text.');
    });

    it('works from the headline line itself', () => {
        expect(buildHeadingEmail(doc, 2)!.subject).toBe('Meeting notes for project X');
    });

    it('uses the innermost heading', () => {
        const email = buildHeadingEmail(doc, 15)!;
        expect(email.subject).toBe('Sub heading');
        expect(email.body).toBe('More text.');
        expect(email.to).toBe('');
        expect(email.id).toBeUndefined();
    });

    it('returns null outside a heading', () => {
        expect(buildHeadingEmail(doc, 0)).toBeNull();
    });

    it('honors MAIL_* and SUBJECT properties', () => {
        const text = '* Draft\n:PROPERTIES:\n:MAIL_TO: a@b.c\n:SUBJECT: Custom\n:ID: id:xyz\n:END:\nBody';
        const email = buildHeadingEmail(text, 0)!;
        expect(email.subject).toBe('Custom');
        expect(email.to).toBe('a@b.c');
        expect(email.id).toBe('xyz');
        expect(email.body).toBe('Body');
    });
});

describe('normalizeAddresses', () => {
    it('handles empty values', () => {
        expect(normalizeAddresses(undefined)).toBe('');
        expect(normalizeAddresses(' , ')).toBe('');
    });
});

describe('appendIdFooter', () => {
    it('adds the id without path information', () => {
        expect(appendIdFooter('Hi', 'abc')).toBe('Hi\n\n--\norg-id: abc');
        expect(appendIdFooter('', 'abc')).toBe('--\norg-id: abc');
    });
});

describe('compose URLs', () => {
    const email = {
        headingLine: 0,
        subject: 'A & B',
        body: 'line 1\nline 2',
        to: 'a@x.org, b@x.org',
        cc: '',
        bcc: 'c@x.org',
    };

    it('builds a Gmail compose URL', () => {
        const url = new URL(buildGmailUrl(email, 'me@x.org'));
        expect(url.host).toBe('mail.google.com');
        expect(url.searchParams.get('view')).toBe('cm');
        expect(url.searchParams.get('to')).toBe('a@x.org, b@x.org');
        expect(url.searchParams.has('cc')).toBe(false);
        expect(url.searchParams.get('bcc')).toBe('c@x.org');
        expect(url.searchParams.get('su')).toBe('A & B');
        expect(url.searchParams.get('body')).toBe('line 1\nline 2');
        expect(url.searchParams.get('authuser')).toBe('me@x.org');
    });

    it('builds a mailto URL', () => {
        const url = buildMailtoUrl(email);
        expect(url.startsWith('mailto:a%40x.org,b%40x.org?')).toBe(true);
        expect(url).toContain('subject=A%20%26%20B');
        expect(url).toContain('body=line%201%0D%0Aline%202');
        expect(url).not.toContain('cc=&');
    });
});
