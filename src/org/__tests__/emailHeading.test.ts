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
    plainBodyLinks,
    buildGmailSearchUrl,
    inactiveTimestamp,
    withTodoKeyword,
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

    it('resolves org links and keeps quoted commas', () => {
        const ids = new Map([['42', 'bo@y.org']]);
        expect(normalizeAddresses('[[mailto:ana@x.org][Ana]]; [[id:42][Bo]], "Doe, Jo" <jo@z.org>', ids))
            .toBe('Ana <ana@x.org>, Bo <bo@y.org>, "Doe, Jo" <jo@z.org>');
    });

    it('builds a mailto URL without splitting quoted names', () => {
        const url = buildMailtoUrl({ subject: '', body: '', to: '"Doe, Jo" <jo@z.org>, b@x.org', cc: '', bcc: '' });
        expect(url.startsWith(`mailto:${encodeURIComponent('"Doe, Jo" <jo@z.org>')},b%40x.org`)).toBe(true);
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

describe('block-aware subtree', () => {
    const text = `* Top
Intro.
#+begin_example
* not a heading
#+end_example
#+BEGIN_SRC sh
* also not
#+END_SRC
Outro.
* Next
`;
    it('does not end the body at a star line inside a block', () => {
        expect(findHeadingAt(text.split('\n'), 1)).toEqual({ start: 0, end: 8, level: 1 });
        const email = buildHeadingEmail(text, 3)!;
        expect(email.subject).toBe('Top');
        expect(email.body).toContain('* not a heading');
        expect(email.body).toContain('Outro.');
    });
});

describe('plainBodyLinks', () => {
    it('keeps web addresses and drops local paths', () => {
        expect(plainBodyLinks('See [[https://x.org/a?b=1&c=2][the site]] and [[https://y.org]].'))
            .toBe('See the site (https://x.org/a?b=1&c=2) and https://y.org.');
        expect(plainBodyLinks('[[file:~/secret/dir/report.pdf]] [[file:a.org::*H][notes]] [[id:123][task]]'))
            .toBe('report.pdf notes task');
        expect(plainBodyLinks('[[mailto:a@b.c][Al]]')).toBe('Al (a@b.c)');
    });
    it('applies to the email body', () => {
        const email = buildHeadingEmail('* H\nRead [[https://x.org][X]].\n', 0)!;
        expect(email.body.trim()).toBe('Read X (https://x.org).');
    });
});

describe('special characters survive the compose URL', () => {
    it('round-trips & + # ? in subject and body', () => {
        const email = buildHeadingEmail('* Q&A: 1+1 #3?\nA & B + C # D ? E\n', 0)!;
        for (const url of [buildGmailUrl(email), buildMailtoUrl(email)]) {
            const q = new URLSearchParams(url.slice(url.indexOf('?') + 1).replace(/\+/g, '%2B'));
            expect(q.get('su') ?? q.get('subject')).toBe('Q&A: 1+1 #3?');
            expect((q.get('body') ?? '').trim()).toBe('A & B + C # D ? E');
        }
    });
});

describe('buildGmailSearchUrl', () => {
    const id = '3f2a9c1e-5b7d';
    it('searches the default account for the quoted ID', () => {
        expect(buildGmailSearchUrl(id)).toBe('https://mail.google.com/mail/u/0/#search/%223f2a9c1e-5b7d%22');
    });
    it('uses /u/N for an account index', () => {
        expect(buildGmailSearchUrl(id, '2')).toBe('https://mail.google.com/mail/u/2/#search/%223f2a9c1e-5b7d%22');
    });
    it('passes an address as authuser', () => {
        expect(buildGmailSearchUrl(id, 'me@x.org'))
            .toBe('https://mail.google.com/mail/u/0/?authuser=me%40x.org#search/%223f2a9c1e-5b7d%22');
    });
});

describe('inactiveTimestamp', () => {
    it('formats an inactive org timestamp with time', () => {
        expect(inactiveTimestamp(new Date(2026, 10, 8, 9, 5))).toBe('[2026-11-08 Sun 09:05]');
    });
});

describe('withTodoKeyword', () => {
    const states = new Set(['TODO', 'NEXT', 'DONE']);
    it('replaces an existing keyword', () => {
        expect(withTodoKeyword('** TODO [#A] Send draft :work:', states, 'DONE')).toBe('** DONE [#A] Send draft :work:');
    });
    it('adds a keyword to a plain heading', () => {
        expect(withTodoKeyword('* Send draft', states, 'DONE')).toBe('* DONE Send draft');
    });
    it('does not treat a non-keyword first word as a state', () => {
        expect(withTodoKeyword('* Email Bob', states, 'DONE')).toBe('* DONE Email Bob');
    });
    it('returns null when already done or not a heading', () => {
        expect(withTodoKeyword('* DONE Send draft', states, 'DONE')).toBeNull();
        expect(withTodoKeyword('not a heading', states, 'DONE')).toBeNull();
    });
});
