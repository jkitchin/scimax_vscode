import * as vscode from 'vscode';

/**
 * Jump to visible text - avy-style navigation
 * Inspired by https://github.com/abo-abo/avy
 *
 * Keystrokes are read straight from the editor by taking over the built-in
 * `type` command for the duration of a jump, so there is no widget in the way:
 *
 *   1. The command asks for a query of a known length (one character for
 *      gotoChar, two for gotoChar2, none for gotoLine), or for a variable
 *      length query terminated by a pause (gotoCharTimer). Matches highlight
 *      as you type.
 *   2. Once the query is complete, every match is overlaid with a short label
 *      drawn on top of the text at its screen position.
 *   3. Typing the label jumps there. Multi-character labels narrow as you go,
 *      redrawing only the characters that remain to be typed.
 *
 * Labels are assigned nearest-first from the cursor, so the closest targets get
 * the single-character labels.
 *
 * If another extension already owns the `type` command (Vim emulations do),
 * the session falls back to reading keys from an input box.
 */

// Jump label characters (ordered by ease of typing on home row)
const DEFAULT_LABEL_CHARS = 'asdfjklghqweruiopzxcvbnmty';

// Upper bound on labelled targets, to keep pathological queries responsive.
const MAX_TARGETS = 1000;

// A jump that is left hanging releases the keyboard after this long.
const IDLE_TIMEOUT_MS = 15000;

interface JumpConfig {
    labelChars: string;
    timeoutMs: number;
    allVisibleEditors: boolean;
    dimBackground: boolean;
    labelBackground: string;
    labelForeground: string;
}

/** A candidate location, before a label has been assigned. */
interface RawMatch {
    editor: vscode.TextEditor;
    position: vscode.Position;
    length: number;
    lineText: string;
}

/** A candidate location with its jump label. */
interface JumpTarget extends RawMatch {
    label: string;
}

type JumpAction = (target: JumpTarget) => void | Thenable<void>;

interface JumpSpec {
    /** Name shown while the jump is running. */
    title: string;
    /**
     * Characters the query needs before labels are drawn. 0 labels
     * immediately; undefined means a variable length query ended by a pause.
     */
    queryLength?: number;
    /** Gather candidates in one editor's visible ranges. */
    collect: (editor: vscode.TextEditor, query: string) => RawMatch[];
    /** What to do with the chosen target. */
    action: JumpAction;
}

function getJumpConfig(): JumpConfig {
    const cfg = vscode.workspace.getConfiguration('scimax.jump');
    const raw = (cfg.get<string>('labelChars') || DEFAULT_LABEL_CHARS)
        .replace(/\s+/g, '')
        .toLowerCase();
    const chars = Array.from(new Set(raw.split(''))).join('');

    return {
        labelChars: chars.length >= 2 ? chars : DEFAULT_LABEL_CHARS,
        timeoutMs: Math.max(0, cfg.get<number>('timeoutMs') ?? 300),
        allVisibleEditors: cfg.get<boolean>('allVisibleEditors') ?? true,
        dimBackground: cfg.get<boolean>('dimBackground') ?? false,
        labelBackground: cfg.get<string>('labelBackground') || '#d33682',
        labelForeground: cfg.get<string>('labelForeground') || '#ffffff'
    };
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

/**
 * Generate `count` jump labels from `chars`.
 *
 * Small sets get single characters. Larger sets reserve the fewest possible
 * prefixes for two-character labels, so the nearest targets (which are handed
 * labels first) keep their single-character labels.
 */
function generateLabels(count: number, chars: string): string[] {
    const k = chars.length;
    if (count <= 0) return [];
    if (count <= k) return chars.slice(0, count).split('');

    if (count <= k * k) {
        // singles + groups = k, capacity = singles + groups * k
        const groups = Math.min(k, Math.ceil((count - k) / (k - 1)));
        const singles = k - groups;
        const labels: string[] = [];

        for (let i = 0; i < singles; i++) {
            labels.push(chars[i]);
        }
        for (let g = 0; g < groups && labels.length < count; g++) {
            const prefix = chars[singles + g];
            for (let j = 0; j < k && labels.length < count; j++) {
                labels.push(prefix + chars[j]);
            }
        }
        return labels;
    }

    // Very large sets: fixed-width labels, enumerated like an odometer.
    const width = Math.ceil(Math.log(count) / Math.log(k));
    const labels: string[] = [];
    const digits = new Array<number>(width).fill(0);

    while (labels.length < count) {
        labels.push(digits.map(d => chars[d]).join(''));
        for (let i = width - 1; i >= 0; i--) {
            digits[i] = (digits[i] + 1) % k;
            if (digits[i] !== 0) break;
        }
    }
    return labels;
}

/**
 * Rank candidates by distance from the anchor so the closest ones are labelled
 * first. Candidates in other editors sort after everything in the active one.
 */
function sortByDistance(
    matches: RawMatch[],
    anchorEditor: vscode.TextEditor,
    anchor: vscode.Position
): RawMatch[] {
    return matches
        .map(match => {
            const sameEditor = match.editor === anchorEditor;
            const distance =
                Math.abs(match.position.line - anchor.line) * 1000 +
                Math.abs(match.position.character - anchor.character);
            return { match, score: sameEditor ? distance : 1000000 + distance };
        })
        .sort((a, b) => a.score - b.score)
        .map(entry => entry.match);
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

const labelDecorationCache = new Map<string, vscode.TextEditorDecorationType>();
let matchDecoration: vscode.TextEditorDecorationType | undefined;
let dimDecoration: vscode.TextEditorDecorationType | undefined;

/**
 * Decoration that paints `text` on top of the document text at a position.
 *
 * VS Code has no API for an overlay: a `before` attachment is laid out inline,
 * so it shoves the rest of the line sideways and the real text paints over it.
 * The CSS injected through `textDecoration` is the workaround every
 * AceJump-style extension uses. `position: absolute` takes the ::before out of
 * the line's flow (nothing reflows) and lifts it into a paint layer above the
 * source text, where it covers exactly the characters it labels.
 */
function labelDecoration(text: string, cfg: JumpConfig): vscode.TextEditorDecorationType {
    const key = `${text}|${cfg.labelBackground}|${cfg.labelForeground}`;
    let decoration = labelDecorationCache.get(key);

    if (!decoration) {
        decoration = vscode.window.createTextEditorDecorationType({
            before: {
                contentText: text,
                color: cfg.labelForeground,
                backgroundColor: cfg.labelBackground,
                textDecoration:
                    'none; position: absolute; z-index: 100; font-weight: bold;' +
                    ' border-radius: 2px; padding: 0; white-space: pre;'
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        });
        labelDecorationCache.set(key, decoration);
    }

    return decoration;
}

function getMatchDecoration(): vscode.TextEditorDecorationType {
    if (!matchDecoration) {
        matchDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
            border: '1px solid',
            borderColor: new vscode.ThemeColor('editor.findMatchHighlightBorder')
        });
    }
    return matchDecoration;
}

function getDimDecoration(): vscode.TextEditorDecorationType {
    if (!dimDecoration) {
        // Recolor rather than fade: an opacity decoration would take the label
        // ::before down with it.
        dimDecoration = vscode.window.createTextEditorDecorationType({
            color: new vscode.ThemeColor('editorLineNumber.foreground')
        });
    }
    return dimDecoration;
}

/** Applies and clears jump decorations across every labelled editor. */
class LabelPainter {
    private applied = new Map<vscode.TextEditor, vscode.TextEditorDecorationType[]>();

    /** Highlight raw matches while the query is still being typed. */
    highlight(editors: vscode.TextEditor[], matches: RawMatch[]): void {
        this.clear();
        const decoration = getMatchDecoration();

        for (const editor of editors) {
            const ranges = matches
                .filter(match => match.editor === editor)
                .map(match => new vscode.Range(
                    match.position,
                    match.position.translate(0, Math.max(1, match.length))
                ));
            editor.setDecorations(decoration, ranges);
            if (ranges.length > 0) {
                this.track(editor, decoration);
            }
        }
    }

    /** Draw the labels, showing only the characters still to be typed. */
    labels(
        editors: vscode.TextEditor[],
        targets: JumpTarget[],
        consumed: number,
        cfg: JumpConfig
    ): void {
        this.clear();

        if (cfg.dimBackground) {
            const dim = getDimDecoration();
            for (const editor of editors) {
                editor.setDecorations(dim, editor.visibleRanges);
                this.track(editor, dim);
            }
        }

        for (const target of targets) {
            const text = target.label.slice(consumed);
            if (text.length === 0) continue;

            const decoration = labelDecoration(text, cfg);
            const range = new vscode.Range(target.position, target.position);

            // One label string maps to exactly one target, so each decoration
            // type carries a single range.
            target.editor.setDecorations(decoration, [range]);
            this.track(target.editor, decoration);
        }
    }

    clear(): void {
        for (const [editor, decorations] of this.applied) {
            for (const decoration of decorations) {
                editor.setDecorations(decoration, []);
            }
        }
        this.applied.clear();
    }

    private track(editor: vscode.TextEditor, decoration: vscode.TextEditorDecorationType): void {
        const list = this.applied.get(editor);
        if (list) {
            list.push(decoration);
        } else {
            this.applied.set(editor, [decoration]);
        }
    }
}

/* ------------------------------------------------------------------ */
/* Candidate collection                                                */
/* ------------------------------------------------------------------ */

/**
 * Editors to search. Jumping across a split is avy's cross-window behavior.
 */
function jumpEditors(active: vscode.TextEditor, cfg: JumpConfig): vscode.TextEditor[] {
    if (!cfg.allVisibleEditors) return [active];

    const editors = vscode.window.visibleTextEditors.filter(editor =>
        editor === active ||
        editor.document.uri.scheme === 'file' ||
        editor.document.uri.scheme === 'untitled'
    );

    return editors.includes(active) ? editors : [active, ...editors];
}

/** Collect regex matches inside one editor's visible ranges. */
function matchesInEditor(editor: vscode.TextEditor, pattern: RegExp): RawMatch[] {
    const matches: RawMatch[] = [];

    for (const range of editor.visibleRanges) {
        for (let line = range.start.line; line <= range.end.line; line++) {
            const lineText = editor.document.lineAt(line).text;
            const localPattern = new RegExp(pattern.source, pattern.flags);
            let match: RegExpExecArray | null;

            while ((match = localPattern.exec(lineText)) !== null) {
                matches.push({
                    editor,
                    position: new vscode.Position(line, match.index),
                    length: match[0].length,
                    lineText
                });

                // Prevent infinite loop for zero-width matches
                if (match[0].length === 0) {
                    localPattern.lastIndex++;
                }
            }
        }
    }

    return matches;
}

/** Build a collector from a query-to-regex function. */
function patternCollector(
    build: (query: string) => RegExp | undefined
): (editor: vscode.TextEditor, query: string) => RawMatch[] {
    return (editor, query) => {
        const pattern = query.length > 0 ? build(query) : undefined;
        return pattern ? matchesInEditor(editor, pattern) : [];
    };
}

/**
 * Collect visible headings, anchored at column 0 so the label covers the
 * leading stars rather than the title, and so the cursor lands where speed
 * commands are active.
 */
function headingsInEditor(editor: vscode.TextEditor): RawMatch[] {
    const language = editor.document.languageId;

    // Matching by language keeps a "# comment" inside an org source block from
    // being read as a markdown heading.
    const patterns: RegExp[] =
        language === 'org' ? [/^(\*+)\s+\S/] :
        language === 'markdown' ? [/^(#{1,6})\s+\S/] :
        language === 'latex' ? [/^\s*\\(?:part|chapter|(?:sub)*section|paragraph)\*?[[{]/] :
        [/^(\*+)\s+\S/, /^(#{1,6})\s+\S/];

    const matches: RawMatch[] = [];

    for (const range of editor.visibleRanges) {
        for (let line = range.start.line; line <= range.end.line; line++) {
            const lineText = editor.document.lineAt(line).text;
            if (!patterns.some(pattern => pattern.test(lineText))) continue;

            const indent = Math.max(0, lineText.search(/\S/));
            matches.push({
                editor,
                position: new vscode.Position(line, indent),
                length: Math.max(1, lineText.trim().length),
                lineText
            });
        }
    }

    return matches;
}

/** Collect every visible line, anchored at its first non-whitespace character. */
function linesInEditor(editor: vscode.TextEditor, skipEmpty: boolean): RawMatch[] {
    const matches: RawMatch[] = [];

    for (const range of editor.visibleRanges) {
        for (let line = range.start.line; line <= range.end.line; line++) {
            const lineText = editor.document.lineAt(line).text;
            if (skipEmpty && lineText.trim().length === 0) continue;

            const firstNonWhitespace = lineText.search(/\S/);
            const col = firstNonWhitespace >= 0 ? firstNonWhitespace : 0;

            matches.push({
                editor,
                position: new vscode.Position(line, col),
                length: Math.max(1, lineText.trim().length),
                lineText
            });
        }
    }

    return matches;
}

function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------------------------------------------ */
/* Keystroke capture                                                   */
/* ------------------------------------------------------------------ */

interface KeyHandlers {
    char(ch: string): void;
    backspace(): void;
    accept(): void;
    cancel(): void;
}

interface KeySource extends vscode.Disposable {
    setStatus(text: string): void;
}

// The running session, so the escape/backspace keybindings can reach it.
let activeHandlers: KeyHandlers | undefined;

/**
 * Reads keys by taking over the built-in `type` command, leaving focus and the
 * cursor in the editor. Escape and backspace arrive through their own commands,
 * gated on the scimax.jumpActive context key.
 */
class TypeKeySource implements KeySource {
    private disposables: vscode.Disposable[] = [];
    private status: vscode.StatusBarItem;
    private handlers: KeyHandlers;

    private constructor(typeCommand: vscode.Disposable, handlers: KeyHandlers) {
        this.handlers = handlers;
        this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10000);
        this.status.show();

        this.disposables.push(
            typeCommand,
            this.status,
            vscode.window.onDidChangeActiveTextEditor(() => handlers.cancel())
        );

        activeHandlers = handlers;
    }

    /** Returns undefined when another extension already owns `type`. */
    static create(handlers: KeyHandlers): TypeKeySource | undefined {
        let typeCommand: vscode.Disposable;
        try {
            typeCommand = vscode.commands.registerCommand('type', (args: { text?: string }) => {
                const text = typeof args?.text === 'string' ? args.text : '';
                for (const ch of text) {
                    handlers.char(ch);
                }
            });
        } catch {
            return undefined;
        }
        return new TypeKeySource(typeCommand, handlers);
    }

    setStatus(text: string): void {
        this.status.text = text;
    }

    dispose(): void {
        // Only release the keyboard if a later session has not already claimed it.
        if (activeHandlers === this.handlers) {
            activeHandlers = undefined;
        }
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }
}

/**
 * Fallback for when `type` is unavailable: keys are read from an input box by
 * diffing its value. The session state stays authoritative, so a character the
 * session ignores is simply absorbed.
 */
class InputBoxKeySource implements KeySource {
    private input = vscode.window.createInputBox();
    private last = '';
    private closing = false;

    constructor(title: string, handlers: KeyHandlers) {
        this.input.title = title;

        this.input.onDidChangeValue(value => {
            if (value.length > this.last.length) {
                const added = value.slice(this.last.length);
                this.last = value;
                for (const ch of added) {
                    handlers.char(ch);
                }
            } else if (value.length < this.last.length) {
                const removed = this.last.length - value.length;
                this.last = value;
                for (let i = 0; i < removed; i++) {
                    handlers.backspace();
                }
            }
        });
        this.input.onDidAccept(() => handlers.accept());
        this.input.onDidHide(() => {
            if (!this.closing) handlers.cancel();
        });

        this.input.show();
    }

    setStatus(text: string): void {
        this.input.prompt = text;
    }

    dispose(): void {
        this.closing = true;
        this.input.dispose();
    }
}

/* ------------------------------------------------------------------ */
/* Driver                                                              */
/* ------------------------------------------------------------------ */

/**
 * Run one jump session: query, label, select.
 */
async function runJump(spec: JumpSpec): Promise<void> {
    const active = vscode.window.activeTextEditor;
    if (!active) return;

    // Only one session may hold the keyboard.
    activeHandlers?.cancel();

    const cfg = getJumpConfig();
    const editors = jumpEditors(active, cfg);
    const anchor = active.selection.active;
    const painter = new LabelPainter();

    let phase: 'query' | 'labels' = 'query';
    let query = '';
    let typed = '';
    let ignored = 0;
    let targets: JumpTarget[] = [];
    let chosen: JumpTarget | undefined;
    let done = false;
    let source: KeySource | undefined;
    let armTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const collect = (text: string): RawMatch[] => {
        const found: RawMatch[] = [];
        for (const editor of editors) {
            found.push(...spec.collect(editor, text));
        }
        return sortByDistance(found, active, anchor).slice(0, MAX_TARGETS);
    };

    // Every single-key binding in the extension (the speed commands) is guarded
    // on !scimax.jumpActive, because a keybinding always beats the `type`
    // dispatch we capture. Wait for the context to take effect before reading
    // any keys, or the first keystroke can still reach a speed command.
    await vscode.commands.executeCommand('setContext', 'scimax.jumpActive', true);

    await new Promise<void>(resolve => {
        const clearTimers = () => {
            if (armTimer) clearTimeout(armTimer);
            if (idleTimer) clearTimeout(idleTimer);
            armTimer = undefined;
            idleTimer = undefined;
        };

        const finish = (target?: JumpTarget) => {
            if (done) return;
            done = true;
            chosen = target;
            clearTimers();
            painter.clear();
            source?.dispose();
            // A jump that supersedes this one has already cancelled it, and
            // sets the context back to true after this runs.
            void vscode.commands.executeCommand('setContext', 'scimax.jumpActive', false);
            resolve();
        };

        const status = (detail: string) => {
            const shown = query.length > 0 ? ` "${query}"` : '';
            source?.setStatus(`${spec.title}${shown}: ${detail}`);
        };

        /** Show where the matches are while the query is still being typed. */
        const preview = () => {
            const found = collect(query);
            painter.highlight(editors, found);

            if (query.length > 0 && found.length === 0) {
                status('no matches');
            } else if (spec.queryLength === undefined) {
                status(`${found.length} matches, pause for labels`);
            } else {
                const remaining = spec.queryLength - query.length;
                status(`type ${remaining} more character${remaining === 1 ? '' : 's'}`);
            }
        };

        /** Query is complete: assign labels and start reading label keys. */
        const arm = () => {
            const found = collect(query);

            if (found.length === 0) {
                painter.clear();
                if (spec.queryLength === undefined) {
                    status('no matches');
                    return;
                }
                vscode.window.setStatusBarMessage(`${spec.title}: no matches`, 2000);
                finish();
                return;
            }

            if (found.length === 1) {
                finish({ ...found[0], label: '' });
                return;
            }

            const labels = generateLabels(found.length, cfg.labelChars);
            targets = found.map((match, i) => ({ ...match, label: labels[i] }));
            typed = '';
            phase = 'labels';
            painter.labels(editors, targets, 0, cfg);
            status(`${targets.length} targets, type a label`);
        };

        const scheduleArm = () => {
            if (armTimer) clearTimeout(armTimer);
            armTimer = setTimeout(() => {
                armTimer = undefined;
                if (!done && phase === 'query') arm();
            }, cfg.timeoutMs);
        };

        /** Release the keyboard if a jump is left hanging. */
        const resetIdle = () => {
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => finish(), IDLE_TIMEOUT_MS);
        };

        const takeQueryChar = (ch: string) => {
            query += ch;
            preview();

            if (spec.queryLength === undefined) {
                scheduleArm();
            } else if (query.length >= spec.queryLength) {
                arm();
            }
        };

        const takeLabelChar = (ch: string) => {
            const next = typed + ch.toLowerCase();
            const survivors = targets.filter(target => target.label.startsWith(next));

            if (survivors.length === 0) {
                // Unknown key: absorb it and leave the narrowing state alone.
                ignored++;
                status(`no target labelled "${next}"`);
                return;
            }

            typed = next;

            if (survivors.length === 1 && survivors[0].label === typed) {
                finish(survivors[0]);
                return;
            }

            painter.labels(editors, survivors, typed.length, cfg);
            status(`${survivors.length} targets, type a label`);
        };

        const handlers: KeyHandlers = {
            char(ch) {
                if (done) return;
                resetIdle();
                if (phase === 'query') {
                    takeQueryChar(ch);
                } else {
                    takeLabelChar(ch);
                }
            },

            backspace() {
                if (done) return;
                resetIdle();

                if (ignored > 0) {
                    ignored--;
                    return;
                }

                if (phase === 'labels') {
                    if (typed.length > 0) {
                        typed = typed.slice(0, -1);
                        const survivors = targets.filter(t => t.label.startsWith(typed));
                        painter.labels(editors, survivors, typed.length, cfg);
                        status(`${survivors.length} targets, type a label`);
                        return;
                    }
                    if (spec.queryLength === undefined) {
                        // Back to editing the query.
                        phase = 'query';
                        targets = [];
                        query = query.slice(0, -1);
                        preview();
                        scheduleArm();
                        return;
                    }
                    finish();
                    return;
                }

                if (query.length === 0) {
                    finish();
                    return;
                }
                query = query.slice(0, -1);
                preview();
                if (spec.queryLength === undefined) scheduleArm();
            },

            accept() {
                if (done) return;
                if (phase === 'labels') {
                    const survivors = targets.filter(t => t.label.startsWith(typed));
                    finish(survivors[0]);
                } else {
                    finish();
                }
            },

            cancel() {
                finish();
            }
        };

        source = TypeKeySource.create(handlers) ?? new InputBoxKeySource(spec.title, handlers);
        resetIdle();

        if (spec.queryLength === 0) {
            arm();
        } else {
            preview();
        }
    });

    if (chosen) {
        await spec.action(chosen);
    }
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

/** Focus the target's editor, which may be a different split. */
async function focusTarget(target: JumpTarget): Promise<vscode.TextEditor> {
    if (vscode.window.activeTextEditor === target.editor) {
        return target.editor;
    }
    return vscode.window.showTextDocument(target.editor.document, {
        viewColumn: target.editor.viewColumn,
        preview: false
    });
}

async function jumpToTarget(target: JumpTarget): Promise<void> {
    const editor = await focusTarget(target);
    editor.selection = new vscode.Selection(target.position, target.position);
    editor.revealRange(
        new vscode.Range(target.position, target.position),
        vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );
}

async function copyTargetLine(target: JumpTarget): Promise<void> {
    await vscode.env.clipboard.writeText(target.lineText);
    vscode.window.showInformationMessage(`Copied line ${target.position.line + 1}`);
}

async function killTargetLine(target: JumpTarget): Promise<void> {
    const editor = await focusTarget(target);
    const line = editor.document.lineAt(target.position.line);
    await editor.edit(editBuilder => {
        editBuilder.delete(line.rangeIncludingLineBreak);
    });
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

/**
 * Jump to char - type one character, then a label
 */
function jumpGotoChar(): Promise<void> {
    return runJump({
        title: 'Jump to character',
        queryLength: 1,
        collect: patternCollector(query => new RegExp(escapeRegex(query), 'gi')),
        action: jumpToTarget
    });
}

/**
 * Jump to char 2 - type a two-character sequence, then a label
 */
function jumpGotoChar2(): Promise<void> {
    return runJump({
        title: 'Jump to 2 characters',
        queryLength: 2,
        collect: patternCollector(query => new RegExp(escapeRegex(query), 'gi')),
        action: jumpToTarget
    });
}

/**
 * Jump to text - type any number of characters, pause, then a label
 */
function jumpGotoCharTimer(): Promise<void> {
    return runJump({
        title: 'Jump to text',
        collect: patternCollector(query => new RegExp(escapeRegex(query), 'gi')),
        action: jumpToTarget
    });
}

/**
 * Jump to word - type the first character of a word, then a label
 */
function jumpGotoWord(): Promise<void> {
    return runJump({
        title: 'Jump to word',
        queryLength: 1,
        collect: patternCollector(query =>
            new RegExp(`\\b${escapeRegex(query)}\\w*`, 'gi')
        ),
        action: jumpToTarget
    });
}

/**
 * Jump to subword - type a character that starts a camelCase or snake_case part
 */
function jumpGotoSubword(): Promise<void> {
    return runJump({
        title: 'Jump to subword',
        queryLength: 1,
        collect: patternCollector(query => {
            const upper = escapeRegex(query.toUpperCase());
            const lower = escapeRegex(query.toLowerCase());
            return new RegExp(
                `(?<=[a-z0-9])${upper}|(?<=[_\\-])[${lower}${upper}]|\\b[${lower}${upper}]`,
                'g'
            );
        }),
        action: jumpToTarget
    });
}

/**
 * Jump to heading - label every visible heading
 *
 * In a folded buffer this is close to the whole outline, which is where an
 * overlay beats the fuzzy picker in scimax.org.jumpToHeading.
 */
function jumpGotoHeading(): Promise<void> {
    return runJump({
        title: 'Jump to heading',
        queryLength: 0,
        collect: headingsInEditor,
        action: jumpToTarget
    });
}

/**
 * Jump to line - label every visible line
 */
function jumpGotoLine(): Promise<void> {
    return runJump({
        title: 'Jump to line',
        queryLength: 0,
        collect: editor => linesInEditor(editor, false),
        action: jumpToTarget
    });
}

/**
 * Jump to symbol - label visible definitions, headings and comment markers
 */
function jumpGotoSymbol(): Promise<void> {
    const symbolPatterns = [
        /^(\s*)(function|def|class|interface|type|const|let|var|export|async|public|private|protected)\s+(\w+)/,
        /^(\s*)(\*+)\s+(.+)$/,      // Org headings
        /^(\s*)(#{1,6})\s+(.+)$/,   // Markdown headings
        /^(\s*)(\/\/|#|\/\*)\s*(TODO|FIXME|NOTE|HACK|XXX)/i, // Comment markers
    ];

    return runJump({
        title: 'Jump to symbol',
        queryLength: 0,
        collect: editor => {
            const matches: RawMatch[] = [];

            for (const range of editor.visibleRanges) {
                for (let line = range.start.line; line <= range.end.line; line++) {
                    const lineText = editor.document.lineAt(line).text;

                    for (const pattern of symbolPatterns) {
                        const match = pattern.exec(lineText);
                        if (match) {
                            const indent = match[1]?.length || 0;
                            matches.push({
                                editor,
                                position: new vscode.Position(line, indent),
                                length: Math.max(1, lineText.trim().length),
                                lineText
                            });
                            break;
                        }
                    }
                }
            }

            return matches;
        },
        action: jumpToTarget
    });
}

/**
 * Jump copy line - label every visible line, copy the one selected
 */
function jumpCopyLine(): Promise<void> {
    return runJump({
        title: 'Copy line',
        queryLength: 0,
        collect: editor => linesInEditor(editor, true),
        action: copyTargetLine
    });
}

/**
 * Jump kill line - label every visible line, delete the one selected
 */
function jumpKillLine(): Promise<void> {
    return runJump({
        title: 'Kill line',
        queryLength: 0,
        collect: editor => linesInEditor(editor, false),
        action: killTargetLine
    });
}

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */

const EXTENSION_ID = 'jkitchin.scimax-vscode';

/** The jump commands offered by the C-c j ? menu, in a useful order. */
const JUMP_MENU: Array<{ command: string; label: string; detail: string }> = [
    { command: 'scimax.jump.gotoChar', label: 'Character', detail: 'Type one character, then a label' },
    { command: 'scimax.jump.gotoChar2', label: 'Two characters', detail: 'Type two characters, then a label' },
    { command: 'scimax.jump.gotoCharTimer', label: 'Text', detail: 'Type any number of characters, pause, then a label' },
    { command: 'scimax.jump.gotoWord', label: 'Word', detail: 'Type the first character of a word, then a label' },
    { command: 'scimax.jump.gotoSubword', label: 'Subword', detail: 'Type a character starting a camelCase or snake_case part' },
    { command: 'scimax.jump.gotoHeading', label: 'Heading', detail: 'Label every visible heading' },
    { command: 'scimax.jump.gotoSymbol', label: 'Symbol', detail: 'Label visible definitions, headings and TODO comments' },
    { command: 'scimax.jump.gotoLine', label: 'Line', detail: 'Label every visible line' },
    { command: 'scimax.jump.copyLine', label: 'Copy line', detail: 'Label every visible line, copy the one chosen' },
    { command: 'scimax.jump.killLine', label: 'Kill line', detail: 'Label every visible line, delete the one chosen' }
];

/** Render a VS Code keybinding the way the docs and Emacs write it. */
function formatKeybinding(key: string): string {
    return key
        .split(' ')
        .map(part => part
            .replace(/^ctrl\+/, 'C-')
            .replace(/^alt\+/, 'M-')
            .replace(/^shift\+\/$/, '?')
            .replace(/^shift\+/, 'S-'))
        .join(' ');
}

/** Read the jump keybindings back out of our own manifest, so they cannot drift. */
function jumpKeybindings(): Map<string, string> {
    const bound = new Map<string, string>();
    const contributed = vscode.extensions.getExtension(EXTENSION_ID)
        ?.packageJSON?.contributes?.keybindings;

    if (Array.isArray(contributed)) {
        for (const binding of contributed) {
            const command = binding?.command;
            const key = binding?.key;
            if (typeof command === 'string' && typeof key === 'string' && !bound.has(command)) {
                bound.set(command, formatKeybinding(key));
            }
        }
    }

    return bound;
}

/**
 * List the jump commands and run the one chosen.
 */
async function listJumpCommands(): Promise<void> {
    const bound = jumpKeybindings();

    const picked = await vscode.window.showQuickPick(
        JUMP_MENU.map(entry => ({
            label: entry.label,
            description: bound.get(entry.command) ?? '',
            detail: entry.detail,
            command: entry.command
        })),
        { title: 'Jump', placeHolder: 'Choose what to jump to', matchOnDetail: true }
    );

    if (picked) {
        await vscode.commands.executeCommand(picked.command);
    }
}

/**
 * Dispose the cached decoration types (bounded by the label alphabet).
 */
function disposeJumpDecorations(): void {
    for (const decoration of labelDecorationCache.values()) {
        decoration.dispose();
    }
    labelDecorationCache.clear();

    matchDecoration?.dispose();
    matchDecoration = undefined;
    dimDecoration?.dispose();
    dimDecoration = undefined;
}

/**
 * Register all jump commands
 */
export function registerJumpCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.jump.gotoChar', jumpGotoChar),
        vscode.commands.registerCommand('scimax.jump.gotoChar2', jumpGotoChar2),
        vscode.commands.registerCommand('scimax.jump.gotoCharTimer', jumpGotoCharTimer),
        vscode.commands.registerCommand('scimax.jump.gotoWord', jumpGotoWord),
        vscode.commands.registerCommand('scimax.jump.gotoLine', jumpGotoLine),
        vscode.commands.registerCommand('scimax.jump.gotoSymbol', jumpGotoSymbol),
        vscode.commands.registerCommand('scimax.jump.gotoSubword', jumpGotoSubword),
        vscode.commands.registerCommand('scimax.jump.gotoHeading', jumpGotoHeading),
        vscode.commands.registerCommand('scimax.jump.copyLine', jumpCopyLine),
        vscode.commands.registerCommand('scimax.jump.killLine', jumpKillLine),
        vscode.commands.registerCommand('scimax.jump.listCommands', listJumpCommands),

        // Reachable only through the escape/backspace bindings gated on
        // scimax.jumpActive, since those keys never reach the `type` command.
        vscode.commands.registerCommand('scimax.jump.cancel', () => activeHandlers?.cancel()),
        vscode.commands.registerCommand('scimax.jump.backspace', () => activeHandlers?.backspace()),

        { dispose: () => { activeHandlers?.cancel(); disposeJumpDecorations(); } },
        vscode.workspace.onDidChangeConfiguration(event => {
            // Label colors are baked into the decoration types.
            if (event.affectsConfiguration('scimax.jump')) {
                disposeJumpDecorations();
            }
        })
    );
}
