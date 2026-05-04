/**
 * Beamer export backend for org-mode documents.
 *
 * Subclasses LatexExportBackend, reusing the LaTeX machinery (math, tables,
 * lists, links, citations, source blocks, escaping) and overriding only the
 * pieces that beamer changes:
 *   - heading -> frame/section/block dispatch (H: + BEAMER_env)
 *   - block environments via BEAMER_env / B_* tags
 *   - frame options (fragile, allowframebreaks, label, ...) and overlays
 *   - columns (explicit + implicit auto-wrap on sibling BEAMER_col)
 *   - bold -> \alert{} (configurable)
 *   - title slide -> \frame{\titlepage}; TOC inside its own frame
 *   - preamble: \usetheme/\usecolortheme/\useinnertheme/\useoutertheme/\usefonttheme
 *
 * Reference: https://orgmode.org/manual/Beamer-Export.html
 *            https://orgmode.org/worg/exporters/beamer/tutorial.html
 */

import type {
    OrgElement,
    OrgObject,
    OrgDocumentNode,
    HeadlineElement,
    SectionElement,
    SrcBlockElement,
    ExampleBlockElement,
    SpecialBlockElement,
    PlainListElement,
    ItemElement,
    BoldObject,
    ExportSnippetObject,
} from './orgElementTypes';

import type {
    ExportState,
} from './orgExport';

import {
    createExportState,
    escapeString,
    generateId,
    exportObjects,
    shouldExport,
    collectTargets,
    collectFootnotes,
    parseOptionsKeyword,
} from './orgExport';

import {
    LatexExportBackend,
    LatexExportOptions,
    DEFAULT_LATEX_OPTIONS,
    LATEX_SECTIONS,
} from './orgExportLatex';

import { exportHookRegistry } from '../adapters/exportHooksAdapter';
import { parseObjects } from './orgObjects';

// =============================================================================
// Beamer Options
// =============================================================================

/**
 * One entry in the beamer environments table. The `open` template is
 * substituted for each block via `substituteEnvTemplate` (see escape table
 * below). The `close` template is the static closing line.
 *
 * Template escapes (a subset of org-mode `org-beamer-environments-default`):
 *   %a -> action `<2->`           (BEAMER_act non-default form)
 *   %A -> default action `[<2->]` (BEAMER_act default form)
 *   %R -> raw action without brackets/angle: `2-`
 *   %o -> options group `[opt]`   (BEAMER_opt rendered)
 *   %O -> raw options             (BEAMER_opt without brackets)
 *   %h -> escaped headline title
 *   %r -> raw headline title
 *   %H -> `{title}` if non-empty else empty
 *   %U -> `[title]` if non-empty else empty
 *   %l -> auto `\label{id}`
 */
export interface BeamerEnv {
    name: string;
    open: string;
    close: string;
}

export const DEFAULT_BEAMER_ENVS: Record<string, BeamerEnv> = {
    block:          { name: 'block',          open: '\\begin{block}%a{%h}',          close: '\\end{block}' },
    alertblock:     { name: 'alertblock',     open: '\\begin{alertblock}%a{%h}',     close: '\\end{alertblock}' },
    exampleblock:   { name: 'exampleblock',   open: '\\begin{exampleblock}%a{%h}',   close: '\\end{exampleblock}' },
    verse:          { name: 'verse',          open: '\\begin{verse}%a',              close: '\\end{verse}' },
    quotation:      { name: 'quotation',      open: '\\begin{quotation}%a',          close: '\\end{quotation}' },
    quote:          { name: 'quote',          open: '\\begin{quote}%a',              close: '\\end{quote}' },
    structureenv:   { name: 'structureenv',   open: '\\begin{structureenv}%a',       close: '\\end{structureenv}' },
    theorem:        { name: 'theorem',        open: '\\begin{theorem}%a%U%l',        close: '\\end{theorem}' },
    definition:     { name: 'definition',     open: '\\begin{definition}%a%U%l',     close: '\\end{definition}' },
    example:        { name: 'example',        open: '\\begin{example}%a%U%l',        close: '\\end{example}' },
    proof:          { name: 'proof',          open: '\\begin{proof}%a%U',            close: '\\end{proof}' },
    onlyenv:        { name: 'onlyenv',        open: '\\begin{onlyenv}%a',            close: '\\end{onlyenv}' },
    beamercolorbox: { name: 'beamercolorbox', open: '\\begin{beamercolorbox}%o{%h}', close: '\\end{beamercolorbox}' },
};

/** Default frame-level for headline -> frame mapping (Emacs ox-beamer default = 1). */
export const DEFAULT_FRAME_LEVEL = 1;

export interface BeamerExportOptions extends LatexExportOptions {
    /** #+BEAMER_THEME (e.g., "Madrid", "[height=2em] Madrid") */
    theme?: string;
    themeOptions?: string;
    /** #+BEAMER_COLOR_THEME */
    colorTheme?: string;
    colorThemeOptions?: string;
    /** #+BEAMER_FONT_THEME */
    fontTheme?: string;
    fontThemeOptions?: string;
    /** #+BEAMER_INNER_THEME */
    innerTheme?: string;
    innerThemeOptions?: string;
    /** #+BEAMER_OUTER_THEME */
    outerTheme?: string;
    outerThemeOptions?: string;
    /** Heading level at which a headline becomes a frame (H: option). Default 1. */
    frameLevel?: number;
    /** Whether `*bold*` renders as `\alert{}` instead of `\textbf{}`. Default true. */
    boldIsAlert?: boolean;
    /** User-provided extra environments (analog of org-beamer-environments-extra). */
    extraEnvironments?: BeamerEnv[];
    /** Aspect ratio passed via classOptions (e.g. "169" -> "aspectratio=169"). */
    aspectRatio?: string;
}

const DEFAULT_BEAMER_OPTIONS: Partial<BeamerExportOptions> = {
    documentClass: 'beamer',
    classOptions: ['presentation'],
    frameLevel: DEFAULT_FRAME_LEVEL,
    boldIsAlert: true,
    // Beamer ships its own page geometry / fonts. We disable inputenc/fontenc
    // injection by relying on noDefaults-ish behavior in our wrapper.
    hyperref: false,
};

// =============================================================================
// Helpers
// =============================================================================

/**
 * Split `[opts] name` into { options, value } where `value` is the remainder.
 * Returns { options: undefined, value: input } if no leading bracket group.
 */
function splitOptsValue(input: string | undefined): { options?: string; value: string } {
    if (!input) return { value: '' };
    const trimmed = input.trim();
    const m = trimmed.match(/^\[([^\]]*)\]\s*(.*)$/);
    if (m) return { options: m[1], value: m[2].trim() };
    return { value: trimmed };
}

/**
 * Normalize an action specification.
 *   - "<2->"     -> { act: "<2->",   defAct: "",         raw: "2-"  }
 *   - "[<2->]"   -> { act: "",       defAct: "[<2->]",   raw: "2-"  }
 *   - "2-"       -> { act: "<2->",   defAct: "",         raw: "2-"  }
 *   - ""         -> { act: "",       defAct: "",         raw: ""    }
 */
function normalizeAct(spec: string | undefined): { act: string; defAct: string; raw: string } {
    if (!spec) return { act: '', defAct: '', raw: '' };
    const s = spec.trim();
    if (!s) return { act: '', defAct: '', raw: '' };
    // [<...>] -> default action
    let m = s.match(/^\[\s*<([^>]*)>\s*\]$/);
    if (m) return { act: '', defAct: `[<${m[1]}>]`, raw: m[1] };
    // <...> -> action
    m = s.match(/^<([^>]*)>$/);
    if (m) return { act: `<${m[1]}>`, defAct: '', raw: m[1] };
    // bare "2-" or "+-" -> action
    return { act: `<${s}>`, defAct: '', raw: s };
}

/**
 * Parse a comma-separated frame option list ("fragile,allowframebreaks,label=foo")
 * into a Set of trimmed entries. Empty input -> empty set.
 */
function parseOptList(spec: string | undefined): Set<string> {
    const set = new Set<string>();
    if (!spec) return set;
    for (const piece of spec.split(',')) {
        const t = piece.trim();
        if (t) set.add(t);
    }
    return set;
}

function joinOptList(set: Set<string>): string {
    return [...set].join(',');
}

// =============================================================================
// Beamer Backend
// =============================================================================

export class BeamerExportBackend extends LatexExportBackend {
    public readonly name = 'beamer';

    /** True after \appendix has been emitted at least once for this document. */
    private appendixEmitted = false;

    // -------------------------------------------------------------------------
    // Document-level
    // -------------------------------------------------------------------------

    /**
     * Override: resolve Beamer-specific keywords and options, then drive the
     * full export pipeline. Mirrors LatexExportBackend.exportDocument but with:
     *   - documentClass forced to 'beamer'
     *   - BEAMER_THEME / BEAMER_COLOR_THEME / ... captured
     *   - BEAMER_HEADER prepended to LATEX_HEADER
     *   - frameLevel from #+OPTIONS: H:N (default 1)
     */
    exportDocument(doc: OrgDocumentNode, options?: Partial<BeamerExportOptions>): string {
        this.appendixEmitted = false;

        // Document keywords win over options, options win over defaults.
        const documentClass =
            doc.keywords['LATEX_CLASS'] ||
            options?.documentClass ||
            DEFAULT_BEAMER_OPTIONS.documentClass!;

        // classOptions: prefer #+LATEX_CLASS_OPTIONS, then options.classOptions,
        // then default ['presentation']. Append "aspectratio=NNN" when set.
        let classOptions =
            options?.classOptions ?? [...DEFAULT_BEAMER_OPTIONS.classOptions!];
        const classOptsKeyword = doc.keywords['LATEX_CLASS_OPTIONS'];
        if (classOptsKeyword) {
            const m = classOptsKeyword.match(/^\[([^\]]*)\]$/);
            if (m) {
                classOptions = m[1].split(',').map(s => s.trim()).filter(Boolean);
            }
        }
        const aspect = options?.aspectRatio;
        if (aspect && !classOptions.some(o => o.startsWith('aspectratio'))) {
            classOptions = [...classOptions, `aspectratio=${aspect}`];
        }

        // #+OPTIONS: parse (gives us H: as headlineLevel, plus toc/num/etc.)
        const optionsKeyword = doc.keywords['OPTIONS'];
        const parsedOptions = optionsKeyword ? parseOptionsKeyword(optionsKeyword) : {};

        // Resolve theme keywords; each accepts "[opts] name" form.
        const theme = splitOptsValue(doc.keywords['BEAMER_THEME'] ?? options?.theme);
        const colorTheme = splitOptsValue(doc.keywords['BEAMER_COLOR_THEME'] ?? options?.colorTheme);
        const fontTheme = splitOptsValue(doc.keywords['BEAMER_FONT_THEME'] ?? options?.fontTheme);
        const innerTheme = splitOptsValue(doc.keywords['BEAMER_INNER_THEME'] ?? options?.innerTheme);
        const outerTheme = splitOptsValue(doc.keywords['BEAMER_OUTER_THEME'] ?? options?.outerTheme);

        // Combined preamble: LATEX_HEADER lines + BEAMER_HEADER lines + settings.
        const latexHeaders = doc.keywordLists?.['LATEX_HEADER'] || [];
        const beamerHeaders = doc.keywordLists?.['BEAMER_HEADER'] || [];
        const settingsPreamble = options?.preamble || '';
        const preambleParts = [
            settingsPreamble,
            ...latexHeaders,
            ...beamerHeaders,
        ].filter(Boolean);
        const preamble = preambleParts.join('\n');

        // Cite backend (mirror LaTeX backend behavior for #+cite_export:)
        let citeBackendOverride: 'bibtex' | 'biblatex' | undefined;
        const citeExportKeyword = doc.keywords['CITE_EXPORT'];
        if (citeExportKeyword) {
            const first = citeExportKeyword.trim().split(/\s+/)[0]?.toLowerCase();
            if (first === 'bibtex' || first === 'natbib') citeBackendOverride = 'bibtex';
            else if (first === 'biblatex') citeBackendOverride = 'biblatex';
        }

        // Doc-level #+OPTIONS: H:N wins over CLI/settings, which win over default.
        const frameLevel =
            (parsedOptions.headlineLevel && parsedOptions.headlineLevel > 0
                ? parsedOptions.headlineLevel
                : undefined)
            ?? options?.frameLevel
            ?? DEFAULT_FRAME_LEVEL;

        let opts: BeamerExportOptions = {
            ...DEFAULT_LATEX_OPTIONS,
            ...DEFAULT_BEAMER_OPTIONS,
            ...parsedOptions,
            ...options,
            documentClass,
            classOptions,
            preamble,
            backend: 'beamer',
            theme: theme.value || options?.theme,
            themeOptions: theme.options ?? options?.themeOptions,
            colorTheme: colorTheme.value || options?.colorTheme,
            colorThemeOptions: colorTheme.options ?? options?.colorThemeOptions,
            fontTheme: fontTheme.value || options?.fontTheme,
            fontThemeOptions: fontTheme.options ?? options?.fontThemeOptions,
            innerTheme: innerTheme.value || options?.innerTheme,
            innerThemeOptions: innerTheme.options ?? options?.innerThemeOptions,
            outerTheme: outerTheme.value || options?.outerTheme,
            outerThemeOptions: outerTheme.options ?? options?.outerThemeOptions,
            frameLevel,
            ...(citeBackendOverride ? { citeBackend: citeBackendOverride } : {}),
        };

        // Pre-export hooks
        opts = exportHookRegistry.runPreExportHooks({
            document: doc,
            options: opts,
            backend: 'beamer',
        }) as BeamerExportOptions;

        const state = createExportState(opts);

        // Pre-process
        collectTargets(doc, state);
        collectFootnotes(doc, state);

        // #+MACRO: collection (mirror parent)
        if (doc.keywordLists?.['MACRO']) {
            const docMacros: Record<string, string> = {};
            for (const macroDef of doc.keywordLists['MACRO']) {
                const m = macroDef.match(/^(\S+)\s+(.*)$/);
                if (m) docMacros[m[1]] = m[2];
            }
            state.options.macros = { ...state.options.macros, ...docMacros };
        }

        const title = opts.title || doc.keywords['TITLE'] || '';
        const author = opts.author || doc.keywords['AUTHOR'] || '';
        const email = opts.email || doc.keywords['EMAIL'] || '';
        const date = opts.date || doc.keywords['DATE'] || '\\today';

        // Walk the document. Top-level uses headline-list helper for
        // implicit columns at the document root.
        const content = this.exportTopLevel(doc, state, opts);

        let output: string;
        if (opts.bodyOnly) {
            output = content;
        } else {
            output = this.wrapInBeamerDocument(content, {
                title, author, email, date, ...opts,
            }, state);
        }

        output = exportHookRegistry.runPostExportHooks(output, {
            backend: 'beamer',
            options: opts,
        });

        return output;
    }

    /**
     * Walk top-level: emit document section (preamble content), then iterate
     * top-level headlines via the sibling-aware helper.
     */
    protected exportTopLevel(
        doc: OrgDocumentNode,
        state: ExportState,
        opts: BeamerExportOptions
    ): string {
        const parts: string[] = [];
        if (doc.section) {
            const s = this.exportSection(doc.section, state);
            if (s.trim()) parts.push(s);
        }
        const exported = this.exportHeadlineList(doc.children, state, opts, undefined);
        if (exported) parts.push(exported);
        return parts.join('\n\n');
    }

    /**
     * Iterate a list of sibling headlines, handling implicit-columns
     * auto-wrap. `parentEnv` is the BEAMER_env of the surrounding headline (or
     * undefined at document root); when it equals 'columns', the children's
     * BEAMER_col already triggers a column wrapper at the parent level, so we
     * do *not* re-wrap implicitly here.
     */
    protected exportHeadlineList(
        siblings: HeadlineElement[],
        state: ExportState,
        opts: BeamerExportOptions,
        parentEnv: string | undefined
    ): string {
        const out: string[] = [];
        const parentIsColumns = parentEnv === 'columns';

        let i = 0;
        while (i < siblings.length) {
            const cur = siblings[i];
            if (!shouldExport(cur, state.options)) { i++; continue; }

            const env = this.resolveBeamerEnv(cur);
            const hasCol = !!cur.propertiesDrawer?.BEAMER_COL || cur.properties.tags.includes('BMCOL');

            // Implicit columns: when current sibling has a BEAMER_col but
            // its parent isn't a 'columns' env, group consecutive col
            // siblings into a wrapping \begin{columns}...\end{columns}.
            if (hasCol && !parentIsColumns) {
                const group: HeadlineElement[] = [];
                let j = i;
                while (j < siblings.length) {
                    const s = siblings[j];
                    if (!shouldExport(s, state.options)) { j++; continue; }
                    const sCol = !!s.propertiesDrawer?.BEAMER_COL || s.properties.tags.includes('BMCOL');
                    if (!sCol) break;
                    group.push(s);
                    j++;
                }
                out.push(this.emitColumnsWrapper(group, state, opts, undefined));
                i = j;
                continue;
            }

            out.push(this.exportHeadline(cur, state, opts));
            i++;
        }

        return out.join('\n\n');
    }

    /**
     * Render a `\begin{columns}` wrapper around a list of column-children.
     * `colsOpt` may pass [t]/[b]/[T] placement.
     */
    protected emitColumnsWrapper(
        cols: HeadlineElement[],
        state: ExportState,
        opts: BeamerExportOptions,
        colsOpt: string | undefined
    ): string {
        const optStr = colsOpt ? `[${colsOpt}]` : '';
        const inner = cols.map(c => this.emitColumn(c, state, opts)).join('\n');
        return `\\begin{columns}${optStr}\n${inner}\n\\end{columns}`;
    }

    /** Render a single column from a headline that has BEAMER_col set. */
    protected emitColumn(
        headline: HeadlineElement,
        state: ExportState,
        opts: BeamerExportOptions
    ): string {
        const width = headline.propertiesDrawer?.BEAMER_COL?.trim() || '0.5';
        const widthExpr = /^\d*\.?\d+$/.test(width) ? `${width}\\textwidth` : width;
        const body: string[] = [];

        // Render any title content as a heading inside the column? In ox-beamer
        // a column heading title is dropped; the heading is structural only.
        // We do, however, emit content under the heading.
        if (headline.section) {
            const s = this.exportSection(headline.section, state);
            if (s.trim()) body.push(s);
        }
        // Children of a column become blocks (or further nested columns).
        if (headline.children.length) {
            const childContent = this.exportHeadlineList(headline.children, state, opts, 'column');
            if (childContent) body.push(childContent);
        }

        return `\\begin{column}{${widthExpr}}\n${body.join('\n\n')}\n\\end{column}`;
    }

    // -------------------------------------------------------------------------
    // Headline dispatch
    // -------------------------------------------------------------------------

    /**
     * Override headline export with frame/section/block dispatch.
     * Children are walked through `exportHeadlineList` for columns auto-wrap.
     */
    protected exportHeadline(
        headline: HeadlineElement,
        state: ExportState,
        opts: LatexExportOptions,
        _inheritedUnnumbered?: string
    ): string {
        const beamerOpts = opts as BeamerExportOptions;
        const env = this.resolveBeamerEnv(headline);

        // Special envs handled before the role decision
        if (env === 'ignoreheading') {
            return this.renderHeadlineBody(headline, state, beamerOpts, undefined);
        }
        if (env === 'note' || env === 'noteNH') {
            return this.emitNote(headline, env, state, beamerOpts);
        }
        if (env === 'againframe') {
            return this.emitAgainFrame(headline, state);
        }
        if (env === 'appendix') {
            const prefix = this.appendixEmitted ? '' : '\\appendix\n';
            this.appendixEmitted = true;
            // After \appendix, treat the heading as a normal section/frame
            // depending on its level. We re-dispatch with env stripped.
            return prefix + this.exportHeadlineAsRole(headline, state, beamerOpts, undefined);
        }
        if (env === 'columns') {
            return this.emitExplicitColumns(headline, state, beamerOpts);
        }
        if (env === 'column') {
            // A standalone column at the wrong nesting; emit as best-effort.
            return this.emitColumn(headline, state, beamerOpts);
        }

        return this.exportHeadlineAsRole(headline, state, beamerOpts, env);
    }

    /**
     * Compute role (section / frame / block) based on level and BEAMER_env,
     * then dispatch to the right emitter.
     */
    protected exportHeadlineAsRole(
        headline: HeadlineElement,
        state: ExportState,
        opts: BeamerExportOptions,
        env: string | undefined
    ): string {
        const level = headline.properties.level;
        const frameLevel = opts.frameLevel ?? DEFAULT_FRAME_LEVEL;

        let role: 'section' | 'frame' | 'block';
        if (env === 'frame' || env === 'fullframe') {
            role = 'frame';
        } else if (env && env !== 'frame' && env !== 'fullframe' && this.isKnownBlockEnv(env, opts)) {
            // Explicit block env override at any level.
            role = 'block';
        } else if (level < frameLevel) {
            role = 'section';
        } else if (level === frameLevel) {
            role = 'frame';
        } else {
            role = 'block';
        }

        switch (role) {
            case 'section': return this.emitSection(headline, state, opts);
            case 'frame':   return this.emitFrame(headline, state, opts, env === 'fullframe');
            case 'block':   return this.emitBlockEnv(headline, state, opts, env);
        }
    }

    // -------------------------------------------------------------------------
    // Sections (above frame level)
    // -------------------------------------------------------------------------

    /**
     * Emit `\section{Title}` / `\subsection{...}` for a headline above the
     * frame level. Children are walked through `exportHeadlineList`. Section
     * content (paragraphs etc. between the heading and its children) renders
     * verbatim before any child headlines.
     */
    protected emitSection(
        headline: HeadlineElement,
        state: ExportState,
        opts: BeamerExportOptions
    ): string {
        const parts: string[] = [];

        const level = headline.properties.level;
        const sectionIndex = Math.min(level + 1, LATEX_SECTIONS.length - 1);
        // Beamer's preferred mapping: level 1 -> \section (index 2 in LATEX_SECTIONS)
        // We use level-based indexing matching parent LATEX_SECTIONS layout.
        const sectionCmd = LATEX_SECTIONS[sectionIndex];

        const title = headline.properties.title
            ? exportObjects(headline.properties.title, this, state)
            : escapeString(headline.properties.rawValue, 'latex');

        parts.push(`${sectionCmd}{${title}}`);

        if (headline.section) {
            const s = this.exportSection(headline.section, state);
            if (s.trim()) parts.push(s);
        }

        if (headline.children.length) {
            const env = this.resolveBeamerEnv(headline);
            const childContent = this.exportHeadlineList(headline.children, state, opts, env);
            if (childContent) parts.push(childContent);
        }

        return parts.join('\n');
    }

    // -------------------------------------------------------------------------
    // Frames
    // -------------------------------------------------------------------------

    /**
     * Render a frame:
     *   \begin{frame}<act>[opts]{title}{subtitle}
     *   ...body...
     *   \end{frame}
     *
     * Auto-fragile: if any descendant is verbatim-flavored.
     * Auto-label:   added unless allowframebreaks present or label= already set.
     */
    protected emitFrame(
        headline: HeadlineElement,
        state: ExportState,
        opts: BeamerExportOptions,
        isFullFrame: boolean
    ): string {
        const props = headline.propertiesDrawer ?? {};
        const { act, defAct } = normalizeAct(props.BEAMER_ACT);
        const fopt = parseOptList(props.BEAMER_OPT);
        const subtitle = props.BEAMER_SUBTITLE;

        // Body: section content + nested headlines as blocks
        const body = this.renderHeadlineBody(headline, state, opts, headline.properties.level);

        // Auto-fragile
        if (this.frameNeedsFragile(headline) && !fopt.has('fragile')) {
            fopt.add('fragile');
        }
        // Auto-label
        const hasUserLabel = [...fopt].some(o => o.startsWith('label='));
        if (!fopt.has('allowframebreaks') && !hasUserLabel) {
            const label = headline.properties.customId
                || headline.properties.id
                || generateId(headline.properties.rawValue);
            fopt.add(`label=${label}`);
        }

        let title = '';
        if (!isFullFrame) {
            title = headline.properties.title
                ? exportObjects(headline.properties.title, this, state)
                : escapeString(headline.properties.rawValue, 'latex');
        }

        const optStr = fopt.size ? `[${joinOptList(fopt)}]` : '';
        const subStr = subtitle ? `{${escapeString(subtitle, 'latex')}}` : '';
        const head = `\\begin{frame}${act}${defAct}${optStr}{${title}}${subStr}`;

        // Fragile guard: if the body contains a literal `\begin{frame}` it
        // would close our frame prematurely with fragile. Insert a space.
        const safeBody = body.replace(/\\begin\{frame\}/g, '\\begin {frame}');

        return `${head}\n${safeBody}\n\\end{frame}`;
    }

    /**
     * Render the body of a frame or ignoreheading wrapper:
     * the section content followed by all child headlines (each rendered as
     * a block, since they are by definition deeper than the frame level).
     * Children with BEAMER_col are auto-wrapped into a \begin{columns} group.
     */
    protected renderHeadlineBody(
        headline: HeadlineElement,
        state: ExportState,
        opts: BeamerExportOptions,
        _frameOwnerLevel: number | undefined
    ): string {
        const parts: string[] = [];
        if (headline.section) {
            const s = this.exportSection(headline.section, state);
            if (s.trim()) parts.push(s);
        }
        if (headline.children.length) {
            const env = this.resolveBeamerEnv(headline);
            const childContent = this.exportHeadlineList(headline.children, state, opts, env);
            if (childContent) parts.push(childContent);
        }
        return parts.join('\n\n');
    }

    /**
     * True iff the frame body contains any verbatim-flavored element.
     * Walks the section content and child headlines (which become blocks
     * within this frame), but not through nested frames (irrelevant here:
     * within a frame, deeper headlines are always blocks).
     */
    protected frameNeedsFragile(headline: HeadlineElement): boolean {
        if (this.elementsContainVerbatim(headline.section?.children)) return true;
        for (const child of headline.children) {
            if (this.frameNeedsFragile(child)) return true;
        }
        return false;
    }

    private elementsContainVerbatim(elements: OrgElement[] | undefined): boolean {
        if (!elements) return false;
        for (const el of elements) {
            if (
                el.type === 'src-block' ||
                el.type === 'example-block' ||
                el.type === 'fixed-width' ||
                el.type === 'export-block' ||
                el.type === 'verse-block'
            ) {
                return true;
            }
            // Inline verbatim/code objects in paragraphs
            if (el.type === 'paragraph' && (el as any).children) {
                for (const obj of (el as any).children as OrgObject[]) {
                    if (obj.type === 'verbatim' || obj.type === 'code' || obj.type === 'inline-src-block') {
                        return true;
                    }
                }
            }
            if ('children' in el && Array.isArray((el as any).children)) {
                if (this.elementsContainVerbatim((el as any).children)) return true;
            }
        }
        return false;
    }

    // -------------------------------------------------------------------------
    // Block environments
    // -------------------------------------------------------------------------

    /**
     * Render a beamer block (block, alertblock, theorem, ..., or any user-
     * registered env). The default env when `env` is undefined is `block`.
     */
    protected emitBlockEnv(
        headline: HeadlineElement,
        state: ExportState,
        opts: BeamerExportOptions,
        env: string | undefined
    ): string {
        const envName = env && this.isKnownBlockEnv(env, opts) ? env : 'block';
        const props = headline.propertiesDrawer ?? {};
        const { act, defAct, raw } = normalizeAct(props.BEAMER_ACT);
        const fopt = parseOptList(props.BEAMER_OPT);

        const title = headline.properties.title
            ? exportObjects(headline.properties.title, this, state)
            : escapeString(headline.properties.rawValue, 'latex');
        const rawTitle = headline.properties.rawValue;

        const label = headline.properties.customId
            || headline.properties.id
            || generateId(headline.properties.rawValue);

        const tpl = this.lookupEnv(envName, opts);
        if (!tpl) {
            // Unknown env: fall back to a generic environment
            return `\\begin{${envName}}${act}${defAct}\n${this.renderHeadlineBody(headline, state, opts, undefined)}\n\\end{${envName}}`;
        }

        const ctx = {
            act, defAct, raw,
            opt: fopt.size ? `[${joinOptList(fopt)}]` : '',
            rawOpt: joinOptList(fopt),
            headline: title,
            rawHeadline: escapeString(rawTitle, 'latex'),
            titleBraced: title ? `{${title}}` : '',
            titleBracketed: title ? `[${title}]` : '',
            label: `\\label{${label}}`,
        };

        const open = this.substituteEnvTemplate(tpl.open, ctx);
        const close = this.substituteEnvTemplate(tpl.close, ctx);
        const body = this.renderHeadlineBody(headline, state, opts, undefined);
        return `${open}\n${body}\n${close}`;
    }

    /**
     * Check whether `name` is a known block environment (default table or
     * user-extended). The special structural envs (frame, columns, note,
     * appendix, ignoreheading, againframe, fullframe) are NOT block envs.
     */
    protected isKnownBlockEnv(name: string, opts: BeamerExportOptions): boolean {
        if (!name) return false;
        if (this.isStructuralEnv(name)) return false;
        if (DEFAULT_BEAMER_ENVS[name]) return true;
        if (opts.extraEnvironments?.some(e => e.name === name)) return true;
        return false;
    }

    /** Structural BEAMER_env values that bypass block rendering. */
    protected isStructuralEnv(name: string): boolean {
        return (
            name === 'frame' ||
            name === 'fullframe' ||
            name === 'columns' ||
            name === 'column' ||
            name === 'note' ||
            name === 'noteNH' ||
            name === 'againframe' ||
            name === 'appendix' ||
            name === 'ignoreheading'
        );
    }

    protected lookupEnv(name: string, opts: BeamerExportOptions): BeamerEnv | undefined {
        const extra = opts.extraEnvironments?.find(e => e.name === name);
        if (extra) return extra;
        return DEFAULT_BEAMER_ENVS[name];
    }

    /**
     * Substitute %a/%A/%R/%h/%r/%H/%U/%o/%O/%l in a block-env template.
     * Replacement order is fixed, longest specifier first to avoid partial
     * collisions (none today since they are all single-char after %).
     */
    protected substituteEnvTemplate(
        tpl: string,
        ctx: {
            act: string; defAct: string; raw: string;
            opt: string; rawOpt: string;
            headline: string; rawHeadline: string;
            titleBraced: string; titleBracketed: string;
            label: string;
        }
    ): string {
        return tpl
            .replace(/%a/g, ctx.act)
            .replace(/%A/g, ctx.defAct)
            .replace(/%R/g, ctx.raw)
            .replace(/%o/g, ctx.opt)
            .replace(/%O/g, ctx.rawOpt)
            .replace(/%h/g, ctx.headline)
            .replace(/%r/g, ctx.rawHeadline)
            .replace(/%H/g, ctx.titleBraced)
            .replace(/%U/g, ctx.titleBracketed)
            .replace(/%l/g, ctx.label);
    }

    // -------------------------------------------------------------------------
    // BEAMER_env / B_* tag resolution
    // -------------------------------------------------------------------------

    /**
     * Resolve the effective BEAMER_env for a headline:
     *   1. propertiesDrawer.BEAMER_env wins
     *   2. otherwise, scan tags for B_<name> or BMCOL
     *   3. otherwise undefined
     */
    protected resolveBeamerEnv(headline: HeadlineElement): string | undefined {
        const explicit = headline.propertiesDrawer?.BEAMER_ENV?.trim();
        if (explicit) return explicit;
        for (const tag of headline.properties.tags) {
            if (tag === 'BMCOL') return 'column';
            if (tag.startsWith('B_')) return tag.slice(2);
        }
        return undefined;
    }

    // -------------------------------------------------------------------------
    // Special environments
    // -------------------------------------------------------------------------

    /**
     * Explicit columns: parent has BEAMER_env: columns. Each child becomes a
     * \begin{column}{Nwidth}; non-column children are emitted between
     * columns as best-effort (rare in real org-beamer documents).
     */
    protected emitExplicitColumns(
        headline: HeadlineElement,
        state: ExportState,
        opts: BeamerExportOptions
    ): string {
        const colsOpt = headline.propertiesDrawer?.BEAMER_OPT;
        const inner: string[] = [];
        if (headline.section) {
            const s = this.exportSection(headline.section, state);
            if (s.trim()) inner.push(s);
        }
        for (const child of headline.children) {
            if (!shouldExport(child, state.options)) continue;
            const childEnv = this.resolveBeamerEnv(child);
            const hasCol = !!child.propertiesDrawer?.BEAMER_COL || child.properties.tags.includes('BMCOL') || childEnv === 'column';
            if (hasCol) {
                inner.push(this.emitColumn(child, state, opts));
            } else {
                inner.push(this.exportHeadline(child, state, opts));
            }
        }
        const optStr = colsOpt ? `[${colsOpt}]` : '';
        return `\\begin{columns}${optStr}\n${inner.join('\n')}\n\\end{columns}`;
    }

    /**
     * Speaker note: \note[<act>]{title\ncontent} for `note`, or
     * \note[<act>]{content} for `noteNH` (no headline).
     */
    protected emitNote(
        headline: HeadlineElement,
        which: 'note' | 'noteNH',
        state: ExportState,
        opts: BeamerExportOptions
    ): string {
        const props = headline.propertiesDrawer ?? {};
        const { act, defAct } = normalizeAct(props.BEAMER_ACT);
        const title = headline.properties.title
            ? exportObjects(headline.properties.title, this, state)
            : escapeString(headline.properties.rawValue, 'latex');
        const body = this.renderHeadlineBody(headline, state, opts, undefined);
        const inner = which === 'note' && title ? `${title}\n${body}` : body;
        return `\\note${act}${defAct}{${inner}}`;
    }

    /** \againframe<act>[opt]{ref} from BEAMER_ref. */
    protected emitAgainFrame(headline: HeadlineElement, _state: ExportState): string {
        const props = headline.propertiesDrawer ?? {};
        const { act, defAct } = normalizeAct(props.BEAMER_ACT);
        const fopt = parseOptList(props.BEAMER_OPT);
        const ref = props.BEAMER_REF?.trim() || '';
        const optStr = fopt.size ? `[${joinOptList(fopt)}]` : '';
        return `\\againframe${act}${defAct}${optStr}{${ref}}`;
    }

    // -------------------------------------------------------------------------
    // Inline objects
    // -------------------------------------------------------------------------

    /** *bold* -> \alert{...} (configurable). */
    protected exportBold(obj: BoldObject, state: ExportState): string {
        const opts = state.options as BeamerExportOptions;
        const inner = exportObjects(obj.children, this, state);
        if (opts.boldIsAlert === false) {
            return `\\textbf{${inner}}`;
        }
        return `\\alert{${inner}}`;
    }

    /** Pass through @@beamer:...@@ snippets verbatim. */
    protected exportExportSnippet(obj: ExportSnippetObject, state: ExportState): string {
        const backend = obj.properties.backend.toLowerCase();
        if (backend === 'beamer' || backend === 'latex') {
            return obj.properties.value;
        }
        return '';
    }

    // -------------------------------------------------------------------------
    // Plain list with #+ATTR_BEAMER :overlay
    // -------------------------------------------------------------------------

    /**
     * Override plain-list export to support `#+ATTR_BEAMER: :overlay <+->`,
     * which adds an overlay specification to each \item.
     */
    protected exportPlainList(list: PlainListElement, state: ExportState): string {
        const overlay = this.extractAttrBeamerOverlay(list);
        if (!overlay) {
            return super.exportPlainList(list, state);
        }
        // Render as parent would, but with each \item postfixed by the overlay.
        const original = super.exportPlainList(list, state);
        // Replace `\item ` with `\item<overlay> ` (only at start of items)
        return original.replace(/\\item(?=[\s[])/g, `\\item${overlay}`);
    }

    private extractAttrBeamerOverlay(list: PlainListElement): string {
        const attr = list.affiliated?.attr as Record<string, Record<string, string>> | undefined;
        const beamerAttr = attr?.beamer;
        if (!beamerAttr) return '';
        const overlay = beamerAttr.overlay || beamerAttr[':overlay'];
        if (!overlay) return '';
        const trimmed = overlay.trim();
        // Wrap in <...> if user didn't already
        if (trimmed.startsWith('<')) return trimmed;
        return `<${trimmed}>`;
    }

    // -------------------------------------------------------------------------
    // Document wrapper
    // -------------------------------------------------------------------------

    /**
     * Wrap content in a beamer document. Builds preamble (themes + headers)
     * then body (\frame{\titlepage} + optional TOC frame + content).
     */
    protected wrapInBeamerDocument(
        content: string,
        meta: {
            title: string;
            author: string;
            date: string;
            email?: string;
        } & BeamerExportOptions,
        state: ExportState
    ): string {
        const parts: string[] = [];

        if (meta.customHeader) {
            parts.push(meta.customHeader);
            parts.push('');
        } else {
            // documentclass
            const classOpts = meta.classOptions?.length
                ? `[${meta.classOptions.join(',')}]`
                : '';
            parts.push(`\\documentclass${classOpts}{${meta.documentClass}}`);
            parts.push('');

            // Theme commands
            const emitTheme = (cmd: string, name: string | undefined, optStr: string | undefined) => {
                if (!name) return;
                const o = optStr ? `[${optStr}]` : '';
                parts.push(`\\${cmd}${o}{${name}}`);
            };
            emitTheme('usetheme', meta.theme, meta.themeOptions);
            emitTheme('usecolortheme', meta.colorTheme, meta.colorThemeOptions);
            emitTheme('usefonttheme', meta.fontTheme, meta.fontThemeOptions);
            emitTheme('useinnertheme', meta.innerTheme, meta.innerThemeOptions);
            emitTheme('useoutertheme', meta.outerTheme, meta.outerThemeOptions);

            // Common math/graphics packages (beamer brings most things, but
            // these are usually still wanted).
            const preambleStr = meta.preamble || '';
            if (!preambleStr.includes('amsmath')) parts.push('\\usepackage{amsmath}');
            if (!preambleStr.includes('amssymb')) parts.push('\\usepackage{amssymb}');
            if (!preambleStr.includes('graphicx')) parts.push('\\usepackage{graphicx}');
            if (meta.booktabs !== false && !preambleStr.includes('booktabs')) {
                parts.push('\\usepackage{booktabs}');
            }
            if (meta.minted !== false && !preambleStr.includes('minted') && content.includes('\\begin{minted}')) {
                parts.push('\\usepackage{minted}');
            }

            if (preambleStr) {
                parts.push('');
                parts.push(preambleStr);
            }
            parts.push('');
        }

        // Title / author / date metadata commands
        if (meta.title) {
            const titleObjects = parseObjects(meta.title);
            const titleLatex = exportObjects(titleObjects, this, state);
            parts.push(`\\title{${titleLatex}}`);
        }
        if (meta.author && meta.includeAuthor !== false) {
            const authorObjects = parseObjects(meta.author);
            let authorStr = exportObjects(authorObjects, this, state);
            if (meta.email && meta.includeEmail === true) {
                authorStr += `\\\\\\texttt{${escapeString(meta.email, 'latex')}}`;
            }
            parts.push(`\\author{${authorStr}}`);
        }
        if (meta.includeDate !== false) {
            parts.push(`\\date{${meta.date}}`);
        } else {
            parts.push('\\date{}');
        }

        parts.push('');
        parts.push('\\begin{document}');
        parts.push('');

        if (meta.title) {
            parts.push('\\frame{\\titlepage}');
            parts.push('');
        }

        if (meta.toc) {
            parts.push('\\begin{frame}');
            parts.push('  \\frametitle{Outline}');
            parts.push('  \\tableofcontents');
            parts.push('\\end{frame}');
            parts.push('');
        }

        parts.push(content);
        parts.push('');

        if (meta.bibFile) {
            parts.push('\\bibliographystyle{' + (meta.bibStyle || 'plain') + '}');
            parts.push(`\\bibliography{${meta.bibFile}}`);
            parts.push('');
        }

        parts.push('\\end{document}');
        return parts.join('\n');
    }
}

// =============================================================================
// Public API
// =============================================================================

/** Export a parsed org document as a Beamer LaTeX string. */
export function exportToBeamer(
    doc: OrgDocumentNode,
    options?: Partial<BeamerExportOptions>
): string {
    const backend = new BeamerExportBackend();
    return backend.exportDocument(doc, options);
}
