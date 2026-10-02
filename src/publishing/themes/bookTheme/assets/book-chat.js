/**
 * Book Theme: "Ask the docs" chat
 *
 * Finds the sections of the site that answer a question, and on request has
 * a language model that runs in the reader's browser (WebLLM on WebGPU) write
 * an answer from them; nothing is sent to a server.
 *
 * Each question is searched (BM25) in _static/chat-index.json, the sections
 * the publisher split the pages into. A small cross-encoder (transformers.js)
 * reranks the best 30, and the top sections are listed with the part of their
 * text that matches. "Write an answer" gives them to the model, which cites
 * them as [1], [2]...
 *
 * The language model is downloaded only after the reader agrees to it; both
 * models are kept in the browser cache for later visits.
 *
 * The functions that do not touch the page (search, prompt, answer parsing)
 * are exported for tests when this file is loaded as a CommonJS module.
 */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.ScimaxChat = api;
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', api.start);
        } else {
            api.start();
        }
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /** transformers.js, pinned, and the cross-encoder that reranks the search hits */
    var TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0';
    var RERANK_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2';

    /** Characters of each section shown under its title */
    var SNIPPET_CHARS = 220;

    /** WebLLM, pinned: its model IDs change between versions */
    var WEBLLM_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm';

    var DEFAULT_PROMPT =
        'You answer questions about the {site} documentation. ' +
        'Use only the numbered documentation excerpts in the question. ' +
        'Cite the excerpts you use with their numbers in brackets, like [1] or [2]. ' +
        'Give command names, settings and key sequences exactly as the excerpts write them. ' +
        'If the excerpts do not answer the question, say that you could not find it in the documentation. ' +
        'Keep the answer short.';

    /** Download sizes in MB (WebLLM's vram_required_MB) shown in the model menu */
    var MODEL_SIZES = {
        'SmolLM2-135M-Instruct-q0f16-MLC': 360,
        'SmolLM2-360M-Instruct-q4f16_1-MLC': 376,
        'Llama-3.2-1B-Instruct-q4f16_1-MLC': 879,
        'Qwen2.5-0.5B-Instruct-q4f16_1-MLC': 945,
        'Qwen2.5-1.5B-Instruct-q4f16_1-MLC': 1630,
        'Llama-3.2-3B-Instruct-q4f16_1-MLC': 2264,
        'Qwen2.5-3B-Instruct-q4f16_1-MLC': 2505,
        'Phi-3.5-mini-instruct-q4f16_1-MLC': 3672,
    };

    /** Where the reader's choice of model is remembered */
    var MODEL_KEY = 'scimax-chat-model';

    /** Most sections from one page given with a question, so one long reference page cannot fill the list */
    var PER_PAGE = 2;

    /** Questions in a conversation kept for follow-ups (each with its answer) */
    var HISTORY_TURNS = 2;

    var STOPWORDS = {};
    ('a an and are as at be by can do does for from how i if in is it of on or that the this ' +
        'to use what when where which who why with you your my me').split(' ').forEach(function (w) {
        STOPWORDS[w] = true;
    });

    /** The first k hits, with at most perPage from any one page */
    function diversify(hits, k, perPage) {
        var counts = {};
        var kept = [];
        for (var i = 0; i < hits.length && kept.length < k; i++) {
            var page = hits[i].chunk.url.split('#')[0];
            counts[page] = (counts[page] || 0) + 1;
            if (counts[page] <= perPage) kept.push(hits[i]);
        }
        return kept;
    }

    // =========================================================================
    // Models
    // =========================================================================

    /** A model's name in the menu: its ID without the quantization, and its size */
    function modelLabel(id) {
        var name = String(id).replace(/-q\d+f\d+(_\d+)?-MLC$/, '').replace(/-MLC$/, '');
        var mb = MODEL_SIZES[id];
        if (!mb) return name;
        return name + ' (' + (mb < 1000 ? Math.round(mb / 10) * 10 + ' MB' : (mb / 1000).toFixed(1) + ' GB') + ')';
    }

    /** The models to offer: the configured ones, the default first */
    function modelChoices(settings) {
        var models = (settings.models || []).filter(function (m) { return m !== settings.model; });
        return [settings.model].concat(models);
    }

    /** The model to start with: the reader's earlier choice if it is still offered */
    function initialModel(settings, stored) {
        return stored && modelChoices(settings).indexOf(stored) >= 0 ? stored : settings.model;
    }

    function readStoredModel() {
        try { return localStorage.getItem(MODEL_KEY); } catch (e) { return null; }
    }

    function storeModel(id) {
        try { localStorage.setItem(MODEL_KEY, id); } catch (e) { /* not kept */ }
    }

    // =========================================================================
    // Search
    // =========================================================================

    /**
     * Words of a text for searching. A dotted or hyphenated name such as
     * scimax.export.pdf.profile is kept whole and also split into its parts,
     * so both the full name and a part of it match.
     */
    function tokenize(text) {
        var words = String(text).toLowerCase().match(/[a-z0-9][a-z0-9._+-]*[a-z0-9]|[a-z0-9]/g) || [];
        var tokens = [];
        words.forEach(function (word) {
            if (/[._+-]/.test(word)) {
                tokens.push(word);
                word.split(/[._+-]+/).forEach(function (part) {
                    if (part && !STOPWORDS[part]) tokens.push(stem(part));
                });
            } else if (!STOPWORDS[word]) {
                tokens.push(stem(word));
            }
        });
        return tokens;
    }

    /** Drop a plural "s" so "exports" matches "export" */
    function stem(word) {
        return word.length > 3 && /[^s]s$/.test(word) ? word.slice(0, -1) : word;
    }

    /** Words in a section's heading and path count this many times */
    var HEADING_WEIGHT = 3;

    /**
     * BM25 index of the chat chunks
     * @param {Array<{heading: string, path: string[], text: string}>} chunks
     */
    /** A text's search terms: its words and each pair of neighbouring words, so phrases rank higher */
    function terms(text) {
        var words = tokenize(text);
        var pairs = [];
        for (var i = 1; i < words.length; i++) pairs.push(words[i - 1] + ' ' + words[i]);
        return words.concat(pairs);
    }

    function Bm25(chunks) {
        this.chunks = chunks;
        this.docs = [];
        this.df = {};
        var total = 0;
        var self = this;
        chunks.forEach(function (chunk) {
            var tf = {};
            var length = 0;
            var add = function (tokens, weight) {
                tokens.forEach(function (t) {
                    tf[t] = (tf[t] || 0) + weight;
                    length += weight;
                });
            };
            add(terms((chunk.path || []).join(' ') + ' ' + chunk.heading), HEADING_WEIGHT);
            add(terms(chunk.text), 1);
            Object.keys(tf).forEach(function (t) {
                self.df[t] = (self.df[t] || 0) + 1;
            });
            self.docs.push({ tf: tf, length: length });
            total += length;
        });
        this.avgLength = chunks.length ? total / chunks.length : 1;
    }

    /**
     * The best chunks for a query, best first
     * @returns {Array<{chunk: object, score: number}>}
     */
    Bm25.prototype.search = function (query, k) {
        var k1 = 1.2;
        var b = 0.75;
        var n = this.docs.length;
        var wanted = terms(query).filter(function (t, i, all) { return all.indexOf(t) === i; });
        var self = this;
        var hits = [];
        this.docs.forEach(function (doc, i) {
            var score = 0;
            wanted.forEach(function (t) {
                var f = doc.tf[t];
                if (!f) return;
                var idf = Math.log(1 + (n - self.df[t] + 0.5) / (self.df[t] + 0.5));
                score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * doc.length / self.avgLength));
            });
            if (score > 0) hits.push({ chunk: self.chunks[i], score: score });
        });
        hits.sort(function (x, y) { return y.score - x.score; });
        return hits.slice(0, k);
    };

    /**
     * The search query for a question. A short follow-up ("and in LaTeX?")
     * is searched together with the question before it.
     */
    function searchQuery(question, previousQuestion) {
        return previousQuestion && tokenize(question).length < 3
            ? previousQuestion + ' ' + question
            : question;
    }

    /**
     * The chunks to give the model: the hits in order, shortened to fit
     * `maxChars` in all
     */
    function selectExcerpts(hits, maxChars) {
        var excerpts = [];
        var left = maxChars;
        for (var i = 0; i < hits.length && left >= 200; i++) {
            var chunk = hits[i].chunk;
            var text = chunk.text.length > left ? chunk.text.slice(0, left) + '…' : chunk.text;
            excerpts.push({ chunk: chunk, text: text });
            left -= text.length;
        }
        return excerpts;
    }

    /** "Export › Build Profiles › Step options" */
    function sectionTitle(chunk) {
        return (chunk.path || []).concat([chunk.heading]).join(' › ');
    }

    // =========================================================================
    // Reranking
    // =========================================================================

    /** BM25 hits the reranker reads */
    var RERANK_CANDIDATES = 30;

    /** Share of the reranker in the blended order; BM25 has the rest */
    var RERANK_WEIGHT = 0.6;

    /** Damps the difference between the first few ranks (reciprocal rank fusion) */
    var FUSION_K = 10;

    /** What the reranker reads of a section */
    function rerankText(chunk) {
        return sectionTitle(chunk) + '\n' + chunk.text.slice(0, 1000);
    }

    /**
     * The order of hits given in BM25 order, blending each hit's rank by the
     * reranker scores with its BM25 rank. The reranker alone sometimes puts a
     * section that only looks like an answer first (an API entry for "change
     * the TODO keywords"); BM25 alone misses answers worded differently.
     * @returns {number[]} indices into the hits, best first
     */
    function blendRanks(scores, weight) {
        var byScore = scores.map(function (s, i) { return i; })
            .sort(function (a, b) { return scores[b] - scores[a]; });
        var rank = [];
        byScore.forEach(function (i, r) { rank[i] = r; });
        var blended = scores.map(function (s, i) {
            return weight / (FUSION_K + rank[i] + 1) + (1 - weight) / (FUSION_K + i + 1);
        });
        return scores.map(function (s, i) { return i; })
            .sort(function (a, b) { return blended[b] - blended[a] || a - b; });
    }

    // =========================================================================
    // Snippets
    // =========================================================================

    function escapeRegExp(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * The part of a section's text that best matches a question, at most
     * about maxChars long, as pieces with the question's words marked.
     * @returns {{text: string, mark: boolean}[]}
     */
    function snippetSegments(text, question, maxChars) {
        var flat = String(text).replace(/\s*\n\s*/g, ' · ');
        var words = (String(question).toLowerCase().match(/[a-z0-9][a-z0-9._+-]*[a-z0-9]/g) || [])
            .filter(function (w, i, all) { return w.length > 2 && !STOPWORDS[w] && all.indexOf(w) === i; })
            .map(function (w) { return w.length > 3 ? stem(w) : w; });
        var pattern = words.length
            ? new RegExp('\\b(' + words.map(escapeRegExp).join('|') + ')[a-z0-9]*', 'gi')
            : null;
        var start = 0;
        var end = flat.length;
        if (flat.length > maxChars) {
            // Start a little before the match with the most matches after it
            var positions = [];
            var m;
            if (pattern) {
                while ((m = pattern.exec(flat)) !== null) positions.push(m.index);
            }
            var best = 0;
            var bestCount = -1;
            positions.forEach(function (p) {
                var count = positions.filter(function (q) { return q >= p && q < p + maxChars - 40; }).length;
                if (count > bestCount) {
                    bestCount = count;
                    best = p;
                }
            });
            start = Math.max(0, best - 40);
            if (start > 0) {
                var space = flat.indexOf(' ', start);
                start = space >= 0 && space < best ? space + 1 : start;
            }
            end = Math.min(flat.length, start + maxChars);
            if (end < flat.length) {
                var lastSpace = flat.lastIndexOf(' ', end);
                if (lastSpace > start) end = lastSpace;
            }
        }
        var shown = (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '');
        var segments = [];
        var at = 0;
        if (pattern) {
            pattern.lastIndex = 0;
            var match;
            while ((match = pattern.exec(shown)) !== null) {
                if (match.index > at) segments.push({ text: shown.slice(at, match.index), mark: false });
                segments.push({ text: match[0], mark: true });
                at = match.index + match[0].length;
            }
        }
        if (at < shown.length) segments.push({ text: shown.slice(at), mark: false });
        return segments;
    }

    // =========================================================================
    // Prompt and answer
    // =========================================================================

    /**
     * Chat messages for a question: the instructions, the earlier questions
     * and answers (without their excerpts, to save the model's short context),
     * then the numbered excerpts and the question.
     */
    function buildMessages(question, excerpts, history, settings) {
        var prompt = (settings.system_prompt || DEFAULT_PROMPT).replace('{site}', settings.site || 'this site\'s');
        var block = excerpts.map(function (e, i) {
            return '[' + (i + 1) + '] ' + sectionTitle(e.chunk) + '\n' + e.text;
        }).join('\n\n');
        return [{ role: 'system', content: prompt }]
            .concat(history.slice(-2 * HISTORY_TURNS))
            .concat([{
                role: 'user',
                content: 'Documentation excerpts:\n\n' + block + '\n\nQuestion: ' + question,
            }]);
    }

    /**
     * Pieces of a model answer to show: text, `code`, **bold**, line breaks
     * and citations of excerpts 1..count. Citations of excerpts that do not
     * exist are left as text.
     * @returns {Array<{type: string, value?: string, refs?: number[]}>}
     */
    function answerSegments(text, count) {
        var pattern = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[(\d+(?:\s*,\s*\d+)*)\]|(\n)/g;
        var segments = [];
        var last = 0;
        var match;
        var pushText = function (value) {
            if (!value) return;
            var prev = segments[segments.length - 1];
            if (prev && prev.type === 'text') prev.value += value;
            else segments.push({ type: 'text', value: value });
        };
        while ((match = pattern.exec(text)) !== null) {
            pushText(text.slice(last, match.index));
            if (match[1] !== undefined) {
                segments.push({ type: 'code', value: match[1] });
            } else if (match[2] !== undefined) {
                segments.push({ type: 'bold', value: match[2] });
            } else if (match[3] !== undefined) {
                var refs = match[3].split(/\s*,\s*/).map(Number);
                var valid = refs.every(function (r) { return r >= 1 && r <= count; });
                if (valid) segments.push({ type: 'cite', refs: refs });
                else pushText(match[0]);
            } else {
                segments.push({ type: 'br' });
            }
            last = pattern.lastIndex;
        }
        pushText(text.slice(last));
        return segments;
    }

    // =========================================================================
    // Page
    // =========================================================================

    function start() {
        var configElement = document.getElementById('book-chat-config');
        var toggle = document.getElementById('chat-toggle');
        if (!configElement || !toggle) return;
        var settings;
        try {
            settings = JSON.parse(configElement.textContent);
        } catch (e) {
            return;
        }
        var chat = new Chat(settings, toggle);
        toggle.addEventListener('click', function () { chat.toggle(); });
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function Chat(settings, toggle) {
        this.settings = settings;
        this.toggleButton = toggle;
        this.panel = null;
        this.index = null;
        this.engine = null;
        this.model = initialModel(settings, readStoredModel());
        this.webllm = null;
        this.loading = null;
        this.busy = false;
        this.history = [];
        this.previousQuestion = '';
    }

    Chat.prototype.toggle = function () {
        if (!this.panel) this.build();
        var open = this.panel.hidden;
        this.panel.hidden = !open;
        this.toggleButton.setAttribute('aria-expanded', String(open));
        // The open panel covers the button's corner, so the button is hidden
        document.body.classList.toggle('book-chat-open', open);
        if (open) this.input.focus();
    };

    Chat.prototype.build = function () {
        var self = this;
        var panel = el('aside', 'book-chat');
        panel.id = 'book-chat';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', this.settings.title);
        panel.hidden = true;

        var head = el('div', 'book-chat-head');
        head.appendChild(el('span', 'book-chat-title', this.settings.title));
        var clear = el('button', 'book-chat-button', 'New chat');
        clear.type = 'button';
        clear.addEventListener('click', function () { self.clear(); });
        var close = el('button', 'book-chat-button book-chat-close', '×');
        close.type = 'button';
        close.setAttribute('aria-label', 'Close');
        close.addEventListener('click', function () { self.toggle(); });
        head.appendChild(clear);
        head.appendChild(close);

        var choose = el('label', 'book-chat-model');
        choose.appendChild(el('span', null, 'Model '));
        this.modelSelect = el('select');
        modelChoices(this.settings).forEach(function (id) {
            var option = el('option', null, modelLabel(id));
            option.value = id;
            self.modelSelect.appendChild(option);
        });
        this.modelSelect.value = this.model;
        this.modelSelect.title = 'Larger models answer better but take longer to download and run';
        this.modelSelect.addEventListener('change', function () { self.chooseModel(self.modelSelect.value); });
        choose.appendChild(this.modelSelect);

        this.log = el('div', 'book-chat-log');
        this.log.setAttribute('aria-live', 'polite');

        this.status = el('div', 'book-chat-status');

        var form = el('form', 'book-chat-form');
        this.input = el('textarea', 'book-chat-input');
        this.input.rows = 2;
        this.input.placeholder = 'Ask a question about these docs';
        this.input.setAttribute('aria-label', 'Question');
        this.send = el('button', 'book-chat-send', 'Ask');
        this.send.type = 'submit';
        form.appendChild(this.input);
        form.appendChild(this.send);
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            if (self.busy) self.stop();
            else self.ask();
        });
        this.input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                if (!self.busy) self.ask();
            }
        });
        panel.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                self.toggle();
                self.toggleButton.focus();
            }
        });

        panel.appendChild(head);
        panel.appendChild(choose);
        panel.appendChild(this.log);
        panel.appendChild(this.status);
        panel.appendChild(form);
        document.body.appendChild(panel);
        this.panel = panel;
        this.intro();
    };

    Chat.prototype.intro = function () {
        var note = el('div', 'book-chat-note');
        note.appendChild(el('p', null,
            'Ask a question to find the sections of these docs that answer it.'));
        note.appendChild(el('p', null,
            'You can then have a small language model write an answer from them. It runs in your browser; ' +
            'nothing you type leaves your computer. It can be wrong, so check the sections it cites.'));
        this.log.appendChild(note);
    };

    Chat.prototype.clear = function () {
        if (this.busy) this.stop();
        this.history = [];
        this.previousQuestion = '';
        this.log.textContent = '';
        this.intro();
        this.input.focus();
    };

    Chat.prototype.setBusy = function (busy) {
        this.busy = busy;
        this.send.textContent = busy ? 'Stop' : 'Ask';
        // The model cannot change while it loads or answers
        this.modelSelect.disabled = busy;
    };

    /** Switches to another model; the next question loads it */
    Chat.prototype.chooseModel = function (id) {
        if (id === this.model) return;
        this.model = id;
        storeModel(id);
        if (this.engine) {
            var old = this.engine;
            this.engine = null;
            Promise.resolve(old.unload()).catch(function () { /* already gone */ });
        }
    };

    Chat.prototype.loadIndex = function () {
        var self = this;
        if (!this.indexPromise) {
            this.indexPromise = fetch(this.settings.root + '_static/chat-index.json')
                .then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                })
                .then(function (data) {
                    self.index = new Bm25(data.chunks || []);
                    return self.index;
                })
                .catch(function (err) {
                    self.indexPromise = null;
                    throw err;
                });
        }
        return this.indexPromise;
    };

    Chat.prototype.ask = function () {
        var self = this;
        var question = this.input.value.trim();
        if (!question) return;
        this.input.value = '';
        this.log.appendChild(el('div', 'book-chat-msg book-chat-user', question));
        var reply = el('div', 'book-chat-msg book-chat-reply');
        this.log.appendChild(reply);
        this.scroll();
        this.setBusy(true);

        this.loadIndex().then(function (index) {
            var query = searchQuery(question, self.previousQuestion);
            self.previousQuestion = question;
            return self.rank(index, query).then(function (hits) {
                var excerpts = selectExcerpts(hits, self.settings.max_context_chars);
                if (excerpts.length === 0) {
                    reply.appendChild(el('div', 'book-chat-answer',
                        'No section of the docs matches that. Try other words, such as the name of a command or setting.'));
                    return;
                }
                reply.appendChild(self.results(excerpts, query));
                reply.appendChild(self.offerAnswer(question, excerpts));
            });
        }).catch(function (err) {
            reply.appendChild(el('div', 'book-chat-answer',
                'Something went wrong: ' + (err && err.message ? err.message : err)));
        }).then(function () {
            self.status.textContent = '';
            self.setBusy(false);
            self.scroll();
        });
    };

    /**
     * The best sections for a query: BM25 candidates reordered with the
     * reranker, at most PER_PAGE from a page. Without the reranker (turned
     * off, or it could not be loaded) the BM25 order is used.
     */
    Chat.prototype.rank = function (index, query) {
        var self = this;
        var k = this.settings.top_k;
        var hits = index.search(query, RERANK_CANDIDATES);
        if (this.settings.rerank === false || hits.length < 2) {
            return Promise.resolve(diversify(hits, k, PER_PAGE));
        }
        return this.loadReranker().then(function (rerank) {
            if (!rerank) return hits;
            self.status.textContent = 'Ranking sections…';
            return rerank(query, hits.map(function (h) { return rerankText(h.chunk); }))
                .then(function (scores) {
                    return blendRanks(scores, RERANK_WEIGHT).map(function (i) { return hits[i]; });
                });
        }).catch(function () {
            return hits;
        }).then(function (ordered) {
            return diversify(ordered, k, PER_PAGE);
        });
    };

    /**
     * The reranker, a small cross-encoder (transformers.js, WebAssembly) that
     * reads the question with each section. Loaded once; resolves to null if
     * it cannot be loaded, and the BM25 order is used from then on.
     */
    Chat.prototype.loadReranker = function () {
        var self = this;
        if (!this.rerankerPromise) {
            this.status.textContent = 'Loading the ranking model (about 23 MB, once)…';
            this.rerankerPromise = import(TRANSFORMERS_URL).then(function (t) {
                return Promise.all([
                    t.AutoTokenizer.from_pretrained(RERANK_MODEL),
                    t.AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL, { dtype: 'q8' }),
                ]);
            }).then(function (parts) {
                var tokenizer = parts[0];
                var model = parts[1];
                return function (query, texts) {
                    var inputs = tokenizer(texts.map(function () { return query; }), {
                        text_pair: texts,
                        padding: true,
                        truncation: true,
                        max_length: 256,
                    });
                    return model(inputs).then(function (output) {
                        return Array.from(output.logits.data);
                    });
                };
            }).catch(function (err) {
                if (window.console) console.warn('Ask the docs: no reranker,', err);
                return null;
            }).then(function (rerank) {
                self.status.textContent = '';
                return rerank;
            });
        }
        return this.rerankerPromise;
    };

    /** The numbered sections, each with the part of its text that matches */
    Chat.prototype.results = function (excerpts, query) {
        var root = this.settings.root;
        var list = el('ol', 'book-chat-results');
        excerpts.forEach(function (e) {
            var item = el('li');
            var link = el('a', 'book-chat-result-title', sectionTitle(e.chunk));
            link.href = root + e.chunk.url;
            item.appendChild(link);
            if (e.chunk.page && e.chunk.page !== e.chunk.heading) {
                item.appendChild(el('span', 'book-chat-page', ' — ' + e.chunk.page));
            }
            var snippet = el('div', 'book-chat-snippet');
            snippetSegments(e.chunk.text, query, SNIPPET_CHARS).forEach(function (s) {
                snippet.appendChild(s.mark ? el('mark', null, s.text) : document.createTextNode(s.text));
            });
            item.appendChild(snippet);
            list.appendChild(item);
        });
        return list;
    };

    /**
     * A button that has the language model write an answer from the
     * sections, or a note that this browser cannot run it
     */
    Chat.prototype.offerAnswer = function (question, excerpts) {
        var self = this;
        var box = el('div', 'book-chat-answer-box');
        if (!navigator.gpu) {
            box.appendChild(el('div', 'book-chat-note-line',
                'Written answers need WebGPU, as in a recent Chrome or Edge.'));
            return box;
        }
        var button = el('button', 'book-chat-button book-chat-write', 'Write an answer from these sections');
        button.type = 'button';
        button.addEventListener('click', function () {
            if (self.busy) return;
            button.remove();
            var answer = el('div', 'book-chat-answer');
            box.appendChild(answer);
            self.setBusy(true);
            self.ensureEngine(answer).then(function (engine) {
                if (!engine) {
                    answer.remove();
                    box.appendChild(button);
                    return;
                }
                return self.generate(engine, question, excerpts, answer);
            }).catch(function (err) {
                answer.textContent = 'Something went wrong: ' + (err && err.message ? err.message : err);
            }).then(function () {
                self.status.textContent = '';
                self.setBusy(false);
                self.scroll();
            });
        });
        box.appendChild(button);
        return box;
    };

    /**
     * The model engine, loading WebLLM and the model the first time. If the
     * model is not in the browser cache yet, asks before downloading it.
     * @returns {Promise<object|null>} null if the reader declines
     */
    Chat.prototype.ensureEngine = function (answer) {
        var self = this;
        if (this.engine) return Promise.resolve(this.engine);
        if (this.loading) return this.loading;
        var model = this.model;
        this.status.textContent = 'Loading WebLLM…';
        this.loading = import(WEBLLM_URL).then(function (webllm) {
            self.webllm = webllm;
            return webllm.hasModelInCache(model).catch(function () { return false; });
        }).then(function (cached) {
            return cached ? model : self.confirmDownload(answer);
        }).then(function (chosen) {
            if (!chosen) return null;
            model = chosen;
            answer.textContent = '';
            var worker = new Worker(new URL(self.settings.root + '_static/book-chat-worker.js', location.href), { type: 'module' });
            return self.webllm.CreateWebWorkerMLCEngine(worker, model, {
                initProgressCallback: function (report) {
                    self.status.textContent = report.text;
                },
            }).then(function (engine) {
                self.engine = engine;
                return engine;
            });
        }).catch(function (err) {
            throw new Error('the model could not be loaded (' + (err && err.message ? err.message : err) + ')');
        }).then(function (engine) {
            self.loading = null;
            return engine;
        }, function (err) {
            self.loading = null;
            throw err;
        });
        return this.loading;
    };

    /**
     * Asks in the reply whether to download the model. The reader can pick
     * another model from the menu while the question is shown.
     * @returns {Promise<string|null>} the model to load, or null to only show the sections
     */
    Chat.prototype.confirmDownload = function (answer) {
        var self = this;
        var models = (this.webllm.prebuiltAppConfig.model_list || []);
        var text = el('p');
        var describe = function () {
            var model = self.model;
            var record = models.filter(function (m) { return m.model_id === model; })[0];
            var size = record && record.vram_required_MB
                ? ' It is about ' + Math.round(record.vram_required_MB / 10) * 10 + ' MB.'
                : '';
            text.textContent = 'To answer, your browser needs to download the model ' + model + ' once.' + size +
                ' It is kept in the browser cache for later visits. You can pick a smaller or larger model above.';
        };
        describe();
        this.status.textContent = '';
        answer.textContent = '';
        var box = el('div', 'book-chat-consent');
        box.appendChild(text);
        var yes = el('button', 'book-chat-send', 'Download and answer');
        var no = el('button', 'book-chat-button', 'Not now');
        yes.type = no.type = 'button';
        box.appendChild(yes);
        box.appendChild(no);
        answer.appendChild(box);
        this.scroll();
        this.modelSelect.disabled = false;
        this.modelSelect.addEventListener('change', describe);
        return new Promise(function (resolve) {
            yes.addEventListener('click', function () { resolve(self.model); });
            no.addEventListener('click', function () { resolve(null); });
        }).then(function (model) {
            self.modelSelect.removeEventListener('change', describe);
            self.modelSelect.disabled = true;
            box.remove();
            return model;
        });
    };

    Chat.prototype.generate = function (engine, question, excerpts, answer) {
        var self = this;
        var messages = buildMessages(question, excerpts, this.history, this.settings);
        var text = '';
        this.status.textContent = 'Thinking…';
        return engine.chat.completions.create({
            messages: messages,
            stream: true,
            temperature: 0.2,
            // Small models otherwise repeat a citation or line until max_tokens
            frequency_penalty: 0.5,
            max_tokens: 512,
        }).then(function (stream) {
            var iterator = stream[Symbol.asyncIterator]();
            var next = function () {
                return iterator.next().then(function (step) {
                    if (step.done) return;
                    var delta = step.value.choices[0] && step.value.choices[0].delta.content;
                    if (delta) {
                        text += delta;
                        self.status.textContent = '';
                        self.render(answer, text, excerpts);
                    }
                    return next();
                });
            };
            return next();
        }).then(function () {
            if (!text) answer.textContent = 'The model gave no answer.';
            self.history.push({ role: 'user', content: question });
            self.history.push({ role: 'assistant', content: text });
            self.history = self.history.slice(-2 * HISTORY_TURNS);
        });
    };

    Chat.prototype.stop = function () {
        if (this.engine) this.engine.interruptGenerate();
    };

    /** Shows the answer so far, with citations as links to the sections */
    Chat.prototype.render = function (answer, text, excerpts) {
        var root = this.settings.root;
        answer.textContent = '';
        answerSegments(text, excerpts.length).forEach(function (s) {
            if (s.type === 'text') {
                answer.appendChild(document.createTextNode(s.value));
            } else if (s.type === 'code') {
                answer.appendChild(el('code', null, s.value));
            } else if (s.type === 'bold') {
                answer.appendChild(el('strong', null, s.value));
            } else if (s.type === 'br') {
                answer.appendChild(el('br'));
            } else if (s.type === 'cite') {
                s.refs.forEach(function (r) {
                    var chunk = excerpts[r - 1].chunk;
                    var link = el('a', 'book-chat-cite', '[' + r + ']');
                    link.href = root + chunk.url;
                    link.title = sectionTitle(chunk);
                    answer.appendChild(link);
                });
            }
        });
        this.scroll();
    };

    Chat.prototype.scroll = function () {
        this.log.scrollTop = this.log.scrollHeight;
    };

    return {
        tokenize: tokenize,
        Bm25: Bm25,
        searchQuery: searchQuery,
        selectExcerpts: selectExcerpts,
        diversify: diversify,
        blendRanks: blendRanks,
        rerankText: rerankText,
        snippetSegments: snippetSegments,
        sectionTitle: sectionTitle,
        buildMessages: buildMessages,
        answerSegments: answerSegments,
        modelLabel: modelLabel,
        modelChoices: modelChoices,
        initialModel: initialModel,
        start: start,
        WEBLLM_URL: WEBLLM_URL,
    };
});
