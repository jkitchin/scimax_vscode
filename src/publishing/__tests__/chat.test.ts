/**
 * Tests for the "Ask the docs" chat of the book theme: the section index the
 * publisher writes, the page markup, and the search, prompt and answer
 * functions of assets/book-chat.js.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';

import { splitSections, splitText, htmlToText, buildChatChunks, generateChatIndex } from '../themes/bookTheme/chatIndex';
import { renderChat } from '../themes/bookTheme/layout';
import { renderHeader } from '../themes/bookTheme/header';
import { loadConfig } from '../orgPublish';
import type { ProjectContext, ThemeConfig } from '../themes/themeTypes';

const chat = createRequire(__filename)('../themes/bookTheme/assets/book-chat.js');

/** Body HTML as the org exporter writes it */
const PAGE = `<nav id="table-of-contents" class="org-toc">
<h2>Table of Contents</h2>
<ul><li><a href="#org-export">Export</a></li></ul>
</nav>
<p>Intro text.</p>
<div id="org-export" class="org-section org-level-1">
<h1>✅ Export</h1>
<div id="org-pdf" class="org-section org-level-2">
<h2>👀 PDF &amp; LaTeX</h2>
<p>Press <code>C-c C-e l p</code> to export.</p>
<table><tr><td>a</td><td>b</td></tr></table>
<div id="org-profiles" class="org-section org-level-3">
<h3>⚠️ Build Profiles</h3>
<ul><li>One</li><li>Two</li></ul>
</div>
</div>
</div>
<div id="org-html" class="org-section org-level-1">
<h1>HTML</h1>
<p>HTML text.</p>
</div>`;

describe('splitSections', () => {
    it('splits a page at its headings, with the path of each section', () => {
        const sections = splitSections(PAGE);
        expect(sections.map(s => [s.id, s.heading, s.path])).toEqual([
            [undefined, '', []],
            ['org-export', 'Export', []],
            ['org-pdf', 'PDF & LaTeX', ['Export']],
            ['org-profiles', 'Build Profiles', ['Export', 'PDF & LaTeX']],
            ['org-html', 'HTML', []],
        ]);
    });

    it('keeps one line per block and leaves out the table of contents', () => {
        const sections = splitSections(PAGE);
        expect(sections[0].text).toBe('Intro text.');
        expect(sections[1].text).toBe('');
        expect(sections[2].text).toBe('Press C-c C-e l p to export.\na | b |');
        expect(sections[3].text).toBe('One\nTwo');
    });
});

describe('htmlToText', () => {
    it('decodes entities once', () => {
        expect(htmlToText('<p>&amp;lt; &lt;b&gt; &#39;x&#39;</p>')).toBe("&lt; <b> 'x'");
    });
});

describe('splitText', () => {
    it('splits at line breaks, and inside a line only when it is too long', () => {
        expect(splitText('aaaa\nbbbb\ncc', 9)).toEqual(['aaaa\nbbbb', 'cc']);
        expect(splitText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
        expect(splitText('', 4)).toEqual([]);
    });
});

describe('buildChatChunks and generateChatIndex', () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-chat-'));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const pages = [{
        title: 'Export Guide',
        path: path.join('guide', 'export.html'),
        content: '',
        headings: [],
        sections: splitSections(PAGE),
    }];

    it('gives each section with text a URL with its anchor, and leaves out empty ones', () => {
        const chunks = buildChatChunks(pages);
        expect(chunks.map(c => c.url)).toEqual([
            'guide/export.html',
            'guide/export.html#org-pdf',
            'guide/export.html#org-profiles',
            'guide/export.html#org-html',
        ]);
        expect(chunks[0].heading).toBe('Export Guide');
        expect(chunks[2]).toMatchObject({ page: 'Export Guide', heading: 'Build Profiles', path: ['Export', 'PDF & LaTeX'] });
    });

    it('writes _static/chat-index.json', async () => {
        await generateChatIndex(pages, dir);
        const index = JSON.parse(fs.readFileSync(path.join(dir, '_static', 'chat-index.json'), 'utf-8'));
        expect(index.version).toBe(1);
        expect(index.chunks).toHaveLength(4);
    });
});

describe('chat configuration and markup', () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scimax-chat-'));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('reads theme.chat from _config.yml', async () => {
        fs.writeFileSync(path.join(dir, '_config.yml'), [
            'title: "Docs"',
            'theme:',
            '  name: "book"',
            '  chat:',
            '    enabled: true',
            '    model: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC"',
            '    top_k: 3',
            '    models:',
            '      - "Qwen2.5-1.5B-Instruct-q4f16_1-MLC"',
            '      - "Llama-3.2-3B-Instruct-q4f16_1-MLC"',
            '',
        ].join('\n'));
        const config = await loadConfig(dir);
        expect(config?.theme?.chat).toMatchObject({
            enabled: true,
            model: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
            top_k: 3,
            models: ['Qwen2.5-1.5B-Instruct-q4f16_1-MLC', 'Llama-3.2-3B-Instruct-q4f16_1-MLC'],
        });
    });

    it('adds nothing when the chat is off', () => {
        expect(renderChat({ name: 'book' }, './')).toEqual({ head: '', body: '' });
        const header = renderHeader({ name: 'book' }, {} as ProjectContext, './');
        expect(header).not.toContain('chat-toggle');
    });

    it('adds the button, the stylesheet, the script and the settings when it is on', () => {
        const config: ThemeConfig = {
            name: 'book',
            header: { title: 'My Docs' },
            // As read from _config.yml: options not given are undefined
            chat: { enabled: true, title: 'Ask </script>', top_k: undefined, model: undefined },
        };
        const { head, body } = renderChat(config, '../');
        expect(head).toContain('href="../_static/book-chat.css"');
        expect(body).toContain('src="../_static/book-chat.js"');
        expect(body).not.toContain('Ask </script>');
        const json = body.match(/<script type="application\/json" id="book-chat-config">(.*?)<\/script>/)![1];
        expect(JSON.parse(json)).toMatchObject({
            enabled: true,
            title: 'Ask </script>',
            site: 'My Docs',
            root: '../',
            top_k: 5,
            model: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
        });
        expect(JSON.parse(json).models[0]).toBe('SmolLM2-360M-Instruct-q4f16_1-MLC');
        expect(body).toContain('id="chat-toggle"');
        expect(body).toContain('<span class="chat-toggle-label">Ask</span>');
        expect(body).toContain('aria-label="Ask &lt;/script&gt;"');
        // The button floats over the page; it is not in the header
        expect(renderHeader(config, {} as ProjectContext, './')).not.toContain('chat-toggle');
    });
});

describe('book-chat.js', () => {
    const chunks = [
        { url: 'a.html#x', page: 'Export', heading: 'Build Profiles', path: ['PDF Export'], text: 'Set scimax.export.pdf.profile to choose a profile.' },
        { url: 'b.html#y', page: 'Agenda', heading: 'Agenda Views', path: [], text: 'The agenda shows scheduled items for the week.' },
        { url: 'c.html#z', page: 'Tables', heading: 'Moving Rows', path: [], text: 'Move a row with M-up and M-down. Exports keep the table.' },
    ];

    it('tokenizes dotted names whole and in parts, without stopwords', () => {
        expect(chat.tokenize('How do I set scimax.export.pdf.profile?')).toEqual(
            ['set', 'scimax.export.pdf.profile', 'scimax', 'export', 'pdf', 'profile']);
        expect(chat.tokenize('Exports')).toEqual(['export']);
    });

    it('ranks sections by BM25, headings first', () => {
        const index = new chat.Bm25(chunks);
        expect(index.search('build profile', 5).map((h: { chunk: { url: string } }) => h.chunk.url)[0]).toBe('a.html#x');
        expect(index.search('scimax.export.pdf.profile', 5)[0].chunk.url).toBe('a.html#x');
        expect(index.search('agenda week', 5)[0].chunk.url).toBe('b.html#y');
        expect(index.search('nothing matches zzz', 5)).toEqual([]);
    });

    it('ranks a section with the words of the question side by side higher', () => {
        const index = new chat.Bm25([
            { url: 'p.html', page: 'P', heading: 'Notes', path: [], text: 'Export the table. Later, PDF files are kept.' },
            { url: 'q.html', page: 'Q', heading: 'Notes', path: [], text: 'Export to PDF with the menu. The table stays.' },
        ]);
        expect(index.search('export to pdf', 2)[0].chunk.url).toBe('q.html');
    });

    it('searches a short follow-up together with the question before it', () => {
        expect(chat.searchQuery('and HTML?', 'How do I export a table')).toBe('How do I export a table and HTML?');
        expect(chat.searchQuery('How do I move a table row', 'earlier')).toBe('How do I move a table row');
        expect(chat.searchQuery('and HTML?', '')).toBe('and HTML?');
    });

    it('keeps at most a few sections from one page', () => {
        const hit = (url: string) => ({ chunk: { url }, score: 1 });
        const hits = ['a.html#1', 'a.html#2', 'a.html#3', 'b.html', 'a.html#4', 'c.html#1'].map(hit);
        expect(chat.diversify(hits, 3, 2).map((h: { chunk: { url: string } }) => h.chunk.url))
            .toEqual(['a.html#1', 'a.html#2', 'b.html']);
        expect(chat.diversify(hits, 10, 1)).toHaveLength(3);
    });

    it('blends the reranker order with the BM25 order', () => {
        // Hits in BM25 order; the reranker likes the third best
        expect(chat.blendRanks([0, 1, 5], 0.6)[0]).toBe(2);
        // With all the weight on BM25 the order is unchanged
        expect(chat.blendRanks([1, 0, 5], 0)).toEqual([0, 1, 2]);
        // A hit both put high beats one only the reranker likes
        expect(chat.blendRanks([4, 3, 0, 0, 0, 0, 0, 0, 0, 5], 0.6).slice(0, 2)).toEqual([0, 1]);
        expect(chat.rerankText(chunks[0])).toBe('PDF Export › Build Profiles\n' + chunks[0].text);
    });

    it('shows the part of a section that matches, with the words marked', () => {
        const plain = (segments: { text: string }[]) => segments.map(s => s.text).join('');
        const marked = (segments: { text: string; mark: boolean }[]) => segments.filter(s => s.mark).map(s => s.text);

        const short = chat.snippetSegments('Move a row\nwith M-up.', 'how do I move rows', 200);
        expect(plain(short)).toBe('Move a row · with M-up.');
        expect(marked(short)).toEqual(['Move', 'row']);

        const long = 'Filler words here. '.repeat(30) + 'Export to PDF with C-c C-e l p. ' + 'More filler text. '.repeat(30);
        const snippet = plain(chat.snippetSegments(long, 'export pdf', 120));
        expect(snippet.startsWith('…')).toBe(true);
        expect(snippet.endsWith('…')).toBe(true);
        expect(snippet).toContain('Export to PDF with C-c C-e l p.');
        expect(snippet.length).toBeLessThanOrEqual(122);

        expect(chat.snippetSegments('Plain text.', 'the a of', 200)).toEqual([{ text: 'Plain text.', mark: false }]);
    });

    it('fits the excerpts into the character budget', () => {
        const hits = [
            { chunk: { ...chunks[0], text: 'x'.repeat(500) }, score: 2 },
            { chunk: { ...chunks[1], text: 'y'.repeat(500) }, score: 1 },
            { chunk: chunks[2], score: 0.5 },
        ];
        const excerpts = chat.selectExcerpts(hits, 800);
        expect(excerpts).toHaveLength(2);
        expect(excerpts[1].text).toBe('y'.repeat(300) + '…');
    });

    it('builds the messages: instructions, recent history, numbered excerpts and question', () => {
        const excerpts = [{ chunk: chunks[0], text: chunks[0].text }];
        const history = [
            { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' },
            { role: 'user', content: 'q2' }, { role: 'assistant', content: 'a2' },
            { role: 'user', content: 'q3' }, { role: 'assistant', content: 'a3' },
        ];
        const messages = chat.buildMessages('Which profile?', excerpts, history, { site: 'Scimax' });
        expect(messages[0].role).toBe('system');
        expect(messages[0].content).toContain('Scimax documentation');
        expect(messages.slice(1, -1).map((m: { content: string }) => m.content)).toEqual(['q2', 'a2', 'q3', 'a3']);
        expect(messages[messages.length - 1].content).toBe(
            'Documentation excerpts:\n\n[1] PDF Export › Build Profiles\n' + chunks[0].text + '\n\nQuestion: Which profile?');
        expect(chat.buildMessages('q', excerpts, [], { system_prompt: 'Custom.' })[0].content).toBe('Custom.');
    });

    it('parses an answer into text, code, bold, line breaks and valid citations', () => {
        expect(chat.answerSegments('Use `C-c C-e` **now** [1, 2].\nSee [3] [x].', 2)).toEqual([
            { type: 'text', value: 'Use ' },
            { type: 'code', value: 'C-c C-e' },
            { type: 'text', value: ' ' },
            { type: 'bold', value: 'now' },
            { type: 'text', value: ' ' },
            { type: 'cite', refs: [1, 2] },
            { type: 'text', value: '.' },
            { type: 'br' },
            { type: 'text', value: 'See [3] [x].' },
        ]);
    });

    it('offers the configured models, the default first, and remembers a choice still offered', () => {
        const settings = { model: 'B', models: ['A', 'B', 'C'] };
        expect(chat.modelChoices(settings)).toEqual(['B', 'A', 'C']);
        expect(chat.modelChoices({ model: 'B' })).toEqual(['B']);
        expect(chat.initialModel(settings, 'C')).toBe('C');
        expect(chat.initialModel(settings, 'gone')).toBe('B');
        expect(chat.initialModel(settings, null)).toBe('B');
    });

    it('labels a model with its short name and download size', () => {
        expect(chat.modelLabel('SmolLM2-360M-Instruct-q4f16_1-MLC')).toBe('SmolLM2-360M-Instruct (380 MB)');
        expect(chat.modelLabel('Qwen2.5-1.5B-Instruct-q4f16_1-MLC')).toBe('Qwen2.5-1.5B-Instruct (1.6 GB)');
        expect(chat.modelLabel('Unknown-Model-q4f32_1-MLC')).toBe('Unknown-Model');
    });

    it('pins the same WebLLM version in the page and the worker', () => {
        const worker = fs.readFileSync(path.join(__dirname, '../themes/bookTheme/assets/book-chat-worker.js'), 'utf-8');
        expect(worker).toContain(`from '${chat.WEBLLM_URL}'`);
    });
});
