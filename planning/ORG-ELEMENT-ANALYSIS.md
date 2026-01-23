# org-element Analysis: What to Adopt, Adapt, or Skip

## Executive Summary

After analyzing org-element.el (~8,000 lines of Emacs Lisp) and comparing it with the existing scimax_vscode parser, my recommendation is:

- **Adopt**: The element/object taxonomy and AST structure concepts
- **Adapt**: Position tracking, property systems, and tree traversal APIs
- **Skip**: Buffer-centric architecture, deferred evaluation, and AVL-tree caching

The existing TypeScript parser is ~75% sufficient for most features. A targeted enhancement adding ~500 lines would cover 95% of use cases, versus ~3,000+ lines for full org-element parity.

---

## Part 1: org-element Architecture Deep Dive

### 1.1 Core Design Philosophy

org-element was designed around Emacs-specific constraints:

```
┌─────────────────────────────────────────────────────────────┐
│                    Emacs Buffer Model                        │
├─────────────────────────────────────────────────────────────┤
│  • Buffer = mutable character array with text properties     │
│  • Point = current cursor position (single integer)          │
│  • All operations reference buffer positions directly        │
│  • Text properties store metadata inline with characters     │
│  • Narrowing restricts visible/accessible region             │
└─────────────────────────────────────────────────────────────┘
```

org-element is fundamentally **buffer-position-centric**: every element stores `:begin`, `:end`, `:contents-begin`, `:contents-end` as buffer positions, and parsing functions operate directly on the buffer using `goto-char`, `looking-at`, `re-search-forward`, etc.

### 1.2 Element Representation

```lisp
;; org-element uses nested lists: (TYPE PROPERTIES CONTENTS)
;; Example headline:
(headline
  (:raw-value "Task title"
   :begin 1
   :end 150
   :pre-blank 0
   :contents-begin 25
   :contents-end 148
   :level 1
   :priority ?A
   :tags ("work" "urgent")
   :todo-keyword "TODO"
   :todo-type todo
   :post-blank 1
   :footnote-section-p nil
   :archivedp nil
   :commentedp nil
   :post-affiliated 1
   :title (#("Task title" 0 10 (:parent #0)))  ; Secondary string with text properties
   :parent #1)
  ; Contents: child elements
  (section ...))
```

**Key observation**: The `:title` property contains a "secondary string" — a list of objects (bold, italic, links, etc.) that require separate parsing. This is because Emacs Lisp lacks a proper string type with embedded structure.

### 1.3 Deferred Evaluation

Starting in Org 9.6, org-element uses **deferred computation**:

```lisp
;; Properties aren't computed until accessed
(org-element-property :title headline)  ; Triggers parsing of title objects

;; The element may store a closure instead of a value
(:title . (deferred org-element--parse-title-deferred ...))
```

This exists because:
1. Full parsing is expensive for large documents
2. Most code only needs a few properties
3. The buffer must exist when resolving deferred values

**For VS Code**: We don't need this. TypeScript is fast enough, and we're parsing strings not buffers.

### 1.4 Caching System

org-element maintains an AVL-tree cache for O(log n) element lookup by position:

```lisp
;; Cache structure (simplified)
org-element--cache        ; AVL tree of (position . element) pairs
org-element--cache-sync-requests  ; Pending invalidations
```

Cache invalidation happens on buffer modifications, using before/after-change hooks.

**For VS Code**: VS Code's `TextDocument` is immutable. Each edit creates a new document version. We can:
1. Use `TextDocumentChangeEvent` for incremental updates
2. Cache at the document level with version keys
3. Leverage SQLite for cross-document caching (already implemented!)

---

## Part 2: Comparison with Current scimax_vscode Parser

### 2.1 What We Already Have

```typescript
// Current OrgDocument structure
interface OrgDocument {
  headings: OrgHeading[];      // ✅ Hierarchical tree
  sourceBlocks: OrgSourceBlock[];  // ✅ Extracted
  links: OrgLink[];            // ✅ Extracted
  timestamps: OrgTimestamp[];  // ✅ Extracted
  properties: Record<string, string>;  // ✅ File-level
  keywords: Record<string, string>;    // ✅ #+KEY: value
}

interface OrgHeading {
  level: number;           // ✅
  title: string;           // ✅ (plain text only)
  todoState?: string;      // ✅
  priority?: string;       // ✅
  tags: string[];          // ✅
  lineNumber: number;      // ✅ (vs :begin/:end positions)
  properties: Record<string, string>;  // ✅
  children: OrgHeading[];  // ✅
}
```

### 2.2 What's Missing

| org-element Feature | scimax Status | Needed For |
|---------------------|---------------|------------|
| Full element types (24+) | ❌ Only 6 types | Export, advanced manipulation |
| Object parsing in text | ❌ Title is plain string | Rich formatting, nested links |
| Character positions | ❌ Only line numbers | Precise editing, selections |
| Contents boundaries | ❌ Not tracked | Subtree operations |
| Parent references | ❌ Not stored | Context-aware operations |
| Affiliated keywords | ❌ Not associated | Export (#+CAPTION, #+NAME) |
| Planning line parsing | Partial | Agenda (SCHEDULED/DEADLINE) |
| Clock/logbook parsing | ❌ | Time tracking |
| Table cell parsing | ❌ | Spreadsheet features |

### 2.3 Feature Gap Analysis

```
                    ┌────────────────────────────────────────┐
                    │        Feature Requirements            │
                    ├────────────────────────────────────────┤
 Current Parser     │  Indexing  Search  Agenda  Edit  Babel │
 Coverage           │    95%      90%     70%    60%   40%   │
                    ├────────────────────────────────────────┤
 With Enhancements  │   100%      95%     95%    90%   85%   │
                    └────────────────────────────────────────┘
```

---

## Part 3: What to Adopt from org-element

### 3.1 Element Type Taxonomy (ADOPT)

The classification of syntax elements is well-designed and worth adopting:

```typescript
// Greater Elements (can contain other elements)
type GreaterElement =
  | 'headline'
  | 'section'
  | 'plain-list'
  | 'item'          // List item
  | 'property-drawer'
  | 'drawer'
  | 'center-block'
  | 'quote-block'
  | 'special-block'
  | 'footnote-definition';

// Lesser Elements (cannot contain elements, only objects)
type LesserElement =
  | 'babel-call'
  | 'clock'
  | 'comment'
  | 'comment-block'
  | 'diary-sexp'
  | 'example-block'
  | 'export-block'
  | 'fixed-width'
  | 'horizontal-rule'
  | 'keyword'
  | 'latex-environment'
  | 'node-property'
  | 'paragraph'
  | 'planning'       // SCHEDULED/DEADLINE/CLOSED line
  | 'src-block'
  | 'table'
  | 'table-row'
  | 'verse-block';

// Objects (inline, within text)
type OrgObject =
  | 'bold'
  | 'code'
  | 'entity'         // \alpha, \rightarrow, etc.
  | 'export-snippet'
  | 'footnote-reference'
  | 'inline-babel-call'
  | 'inline-src-block'
  | 'italic'
  | 'latex-fragment'
  | 'line-break'
  | 'link'
  | 'macro'
  | 'radio-target'
  | 'statistics-cookie'  // [2/5] or [40%]
  | 'strike-through'
  | 'subscript'
  | 'superscript'
  | 'table-cell'
  | 'target'         // <<target>>
  | 'timestamp'
  | 'underline'
  | 'verbatim';
```

**Why adopt**: This taxonomy is stable, documented, and enables proper export handling.

### 3.2 Standard Property Names (ADOPT)

Use org-element's property naming for compatibility:

```typescript
interface ElementProperties {
  // Position (adapt to our needs)
  begin: number;        // Character offset from document start
  end: number;          // End position (exclusive)
  contentsBegin?: number;
  contentsEnd?: number;
  postBlank: number;    // Trailing blank lines

  // Headlines
  level?: number;
  rawValue?: string;    // Original title text
  title?: OrgObject[];  // Parsed title with objects
  todoKeyword?: string;
  todoType?: 'todo' | 'done';
  priority?: number;    // Character code
  tags?: string[];
  archivedp?: boolean;
  commentedp?: boolean;
  footnoteSection?: boolean;

  // Source blocks
  language?: string;
  value?: string;       // Block contents
  parameters?: string;  // Header arguments string

  // Links
  type?: string;        // 'http', 'file', 'id', etc.
  path?: string;        // Link target
  format?: 'plain' | 'angle' | 'bracket';
  rawLink?: string;     // Original link text

  // Timestamps
  timestampType?: 'active' | 'inactive' | 'active-range' | 'inactive-range';
  yearStart?: number;
  monthStart?: number;
  dayStart?: number;
  // ... etc
}
```

### 3.3 Object Restrictions (ADOPT)

org-element defines which objects can appear in which contexts:

```typescript
// Which object types are allowed in each container
const OBJECT_RESTRICTIONS: Record<string, OrgObject[]> = {
  'bold': ['bold', 'code', 'entity', 'italic', 'latex-fragment',
           'link', 'strike-through', 'subscript', 'superscript',
           'underline', 'verbatim'],
  'headline': ['bold', 'code', 'entity', 'footnote-reference',
               'inline-babel-call', 'inline-src-block', 'italic',
               'latex-fragment', 'link', 'macro', 'radio-target',
               'statistics-cookie', 'strike-through', 'subscript',
               'superscript', 'target', 'timestamp', 'underline',
               'verbatim'],
  'paragraph': ['bold', 'code', 'entity', 'export-snippet',
                'footnote-reference', 'inline-babel-call',
                'inline-src-block', 'italic', 'latex-fragment',
                'line-break', 'link', 'macro', 'radio-target',
                'statistics-cookie', 'strike-through', 'subscript',
                'superscript', 'table-cell', 'target', 'timestamp',
                'underline', 'verbatim'],
  // ... more contexts
};
```

**Why adopt**: Prevents invalid nesting during parsing and export.

---

## Part 4: What to Adapt

### 4.1 Position Tracking (ADAPT)

**org-element**: Uses buffer positions (single integers)
**Our adaptation**: Use `{ line, column, offset }` or VS Code's `Position`

```typescript
// Option A: Match VS Code's Position type
interface OrgPosition {
  line: number;      // 0-indexed
  character: number; // 0-indexed column
}

interface OrgRange {
  start: OrgPosition;
  end: OrgPosition;
}

// Option B: Hybrid with offset for efficient operations
interface OrgLocation {
  offset: number;    // Character offset for fast string operations
  line: number;      // For UI display
  column: number;    // For UI display
}

// Recommendation: Store offset, compute line/column lazily
interface OrgElement {
  type: ElementType;
  range: { start: number; end: number };  // Character offsets
  properties: ElementProperties;
  children?: OrgElement[];
}

// Helper to convert offset to Position when needed
function offsetToPosition(content: string, offset: number): vscode.Position {
  const lines = content.slice(0, offset).split('\n');
  return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
}
```

**Rationale**: Character offsets are faster for string operations; VS Code Positions are better for editor integration. Store offsets, convert when needed.

### 4.2 Parent References (ADAPT)

**org-element**: Stores `:parent` as direct reference (creates cycles)
**Our adaptation**: Use optional parent or index-based approach

```typescript
// Option A: WeakRef to avoid memory leaks (ES2021+)
interface OrgElement {
  parent?: WeakRef<OrgElement>;
}

// Option B: Computed on demand (no storage)
class OrgDocument {
  private elements: Map<number, OrgElement>;  // offset → element

  getParent(element: OrgElement): OrgElement | undefined {
    // Walk tree to find parent
  }

  getPath(element: OrgElement): OrgElement[] {
    // Return ancestor chain
  }
}

// Option C: Flat array with parent indices
interface OrgElementFlat {
  index: number;
  parentIndex: number | null;
  // ...
}

// Recommendation: Option B - compute on demand
// Simpler, no cycles, easy serialization
```

### 4.3 Tree Traversal API (ADAPT)

org-element provides `org-element-map` for tree traversal. Adapt to TypeScript idioms:

```typescript
class OrgDocument {
  // Iterate all elements of given types
  *traverse(types?: ElementType[]): Generator<OrgElement> {
    function* walk(element: OrgElement): Generator<OrgElement> {
      if (!types || types.includes(element.type)) {
        yield element;
      }
      for (const child of element.children || []) {
        yield* walk(child);
      }
    }
    for (const child of this.children) {
      yield* walk(child);
    }
  }

  // Find first element matching predicate
  find(predicate: (el: OrgElement) => boolean): OrgElement | undefined {
    for (const el of this.traverse()) {
      if (predicate(el)) return el;
    }
    return undefined;
  }

  // Find all elements matching predicate
  findAll(predicate: (el: OrgElement) => boolean): OrgElement[] {
    return [...this.traverse()].filter(predicate);
  }

  // Get element at position
  elementAt(offset: number): OrgElement | undefined {
    // Binary search or tree walk
  }

  // Get context (element + ancestors)
  contextAt(offset: number): OrgElement[] {
    const element = this.elementAt(offset);
    if (!element) return [];
    return this.getAncestors(element).concat([element]);
  }
}
```

### 4.4 Interpretation (AST → Text) (ADAPT)

org-element has `org-element-interpret-data`. We need this for:
- Modifying and rewriting elements
- Export (generate output format)
- Normalization

```typescript
class OrgInterpreter {
  // Convert AST back to org text
  interpret(element: OrgElement): string {
    const fn = this.interpreters[element.type];
    if (!fn) throw new Error(`No interpreter for ${element.type}`);
    return fn(element, this);
  }

  private interpreters: Record<ElementType, (el: OrgElement, ctx: OrgInterpreter) => string> = {
    'headline': (el, ctx) => {
      const stars = '*'.repeat(el.properties.level!);
      const todo = el.properties.todoKeyword ? `${el.properties.todoKeyword} ` : '';
      const priority = el.properties.priority ? `[#${String.fromCharCode(el.properties.priority)}] ` : '';
      const title = el.properties.rawValue || '';
      const tags = el.properties.tags?.length ? ` :${el.properties.tags.join(':')}:` : '';
      const children = el.children?.map(c => ctx.interpret(c)).join('') || '';
      return `${stars} ${todo}${priority}${title}${tags}\n${children}`;
    },

    'paragraph': (el, ctx) => {
      const content = el.children?.map(c => ctx.interpret(c)).join('') || '';
      return `${content}\n`;
    },

    'bold': (el, ctx) => {
      const content = el.children?.map(c => ctx.interpret(c)).join('') || '';
      return `*${content}*`;
    },

    // ... more interpreters
  };
}
```

---

## Part 5: What to Skip

### 5.1 Buffer-Centric Architecture (SKIP)

**org-element does**: Parses directly from Emacs buffers using `looking-at`, `match-string`, regex searches that operate on buffer state.

**Why skip**: VS Code uses immutable `TextDocument` strings. Our parser already works on strings, which is the correct approach for TypeScript.

```typescript
// org-element style (buffer-centric) - DON'T DO THIS
function parseHeadline(buffer: Buffer): Headline {
  buffer.gotoChar(start);
  if (buffer.lookingAt(/^\*+ /)) {
    const match = buffer.matchString(0);
    // ...
  }
}

// TypeScript style (string-centric) - DO THIS
function parseHeadline(content: string, offset: number): Headline {
  const match = content.slice(offset).match(/^(\*+) (.*)$/m);
  if (match) {
    // ...
  }
}
```

### 5.2 Deferred Evaluation (SKIP)

**org-element does**: Stores closures for expensive properties, resolves on first access.

**Why skip**:
1. TypeScript/V8 is ~10-100x faster than Emacs Lisp
2. We parse strings, not buffers (no buffer existence requirement)
3. Complexity not worth marginal perf gains
4. Makes debugging harder

```typescript
// DON'T do this
interface DeferredHeadline {
  title: () => OrgObject[];  // Closure
}

// DO this - just compute everything
interface Headline {
  title: OrgObject[];  // Already parsed
}
```

**Benchmark reality**: Parsing a 10,000-line org file takes ~50ms in TypeScript. Deferred evaluation might save ~20ms on partial access but adds significant complexity.

### 5.3 AVL-Tree Cache (SKIP)

**org-element does**: Maintains an AVL tree for O(log n) lookup by position, with complex invalidation logic.

**Why skip**:
1. VS Code documents are immutable (new version = new parse)
2. We already have SQLite for cross-document caching
3. A simple `Map<documentUri, { version: number, ast: OrgDocument }>` suffices
4. Modern JS engines handle 10k-element arrays efficiently

```typescript
// Simple and sufficient caching
class ParserCache {
  private cache = new Map<string, { version: number; ast: OrgDocument }>();

  get(document: vscode.TextDocument): OrgDocument {
    const cached = this.cache.get(document.uri.toString());
    if (cached && cached.version === document.version) {
      return cached.ast;
    }

    const ast = this.parser.parse(document.getText());
    this.cache.set(document.uri.toString(), { version: document.version, ast });
    return ast;
  }
}
```

### 5.4 Secondary String Architecture (SKIP/SIMPLIFY)

**org-element does**: Headline titles, captions, etc. are "secondary strings" — lists of objects requiring separate parsing passes.

**Why simplify**: For most use cases, we can:
1. Keep raw text for display
2. Parse objects on-demand only when needed (export, rich display)
3. Use a simpler inline object parser

```typescript
interface Headline {
  rawTitle: string;           // "My *bold* title"
  parsedTitle?: OrgObject[];  // Parsed on demand for export
}

// Parse inline objects only when needed
function parseInlineObjects(text: string): OrgObject[] {
  // Simpler than org-element's approach
  // Only handles: bold, italic, code, verbatim, links, timestamps
}
```

### 5.5 Affiliated Keywords Association (SKIP FOR NOW)

**org-element does**: Associates `#+CAPTION`, `#+NAME`, `#+ATTR_*` with following elements.

**Why defer**: Only needed for export. Can add later without architectural changes.

```typescript
// Future: Add when implementing export
interface ElementWithAffiliates {
  affiliatedKeywords?: {
    caption?: OrgObject[];
    name?: string;
    attr?: Record<string, string>;  // #+ATTR_HTML: :width 100
  };
}
```

---

## Part 6: Recommended Implementation Path

### 6.1 Phase 1: Enhanced Core Types (~200 lines)

Add the element type taxonomy without changing parser architecture:

```typescript
// src/parser/orgElementTypes.ts

export type ElementType = GreaterElement | LesserElement;
export type OrgObjectType = /* ... */;

export interface OrgNode {
  type: ElementType | OrgObjectType;
  range: { start: number; end: number };
  children?: OrgNode[];
}

export interface OrgElement extends OrgNode {
  type: ElementType;
  properties: ElementProperties;
  children?: OrgElement[];
}

export interface OrgObject extends OrgNode {
  type: OrgObjectType;
  properties: ObjectProperties;
  children?: OrgObject[];
}
```

### 6.2 Phase 2: Inline Object Parser (~300 lines)

Add parser for text markup, links, timestamps within paragraphs:

```typescript
// src/parser/orgObjectParser.ts

export function parseObjects(
  text: string,
  allowedTypes?: OrgObjectType[]
): OrgObject[] {
  const objects: OrgObject[] = [];
  let i = 0;

  while (i < text.length) {
    // Try each object type
    const bold = tryParseBold(text, i);
    if (bold && (!allowedTypes || allowedTypes.includes('bold'))) {
      objects.push(bold);
      i = bold.range.end;
      continue;
    }

    // ... more object types

    // Plain text
    i++;
  }

  return objects;
}
```

### 6.3 Phase 3: Enhanced Heading Parser (~200 lines)

Extend existing parser with position tracking and optional object parsing:

```typescript
// Enhance parseHeading in orgParser.ts

interface EnhancedHeading extends OrgHeading {
  range: { start: number; end: number };
  titleRange: { start: number; end: number };
  titleObjects?: OrgObject[];  // Parsed on demand
}
```

### 6.4 Phase 4: Planning/Clock Line Parser (~150 lines)

Add parsing for SCHEDULED, DEADLINE, CLOSED, CLOCK:

```typescript
interface PlanningInfo {
  scheduled?: OrgTimestamp;
  deadline?: OrgTimestamp;
  closed?: OrgTimestamp;
}

interface ClockEntry {
  start: OrgTimestamp;
  end?: OrgTimestamp;
  duration?: string;  // "1:30"
}
```

### 6.5 Phase 5: Interpreter (~200 lines)

Add AST → text conversion for modifications:

```typescript
// src/parser/orgInterpreter.ts
export function interpretElement(element: OrgElement): string { /* ... */ }
export function interpretObject(object: OrgObject): string { /* ... */ }
```

---

## Part 7: Effort Estimation

| Component | org-element LOC | Our Estimate | Parity % |
|-----------|-----------------|--------------|----------|
| Element types & interfaces | ~500 | ~200 | 100% |
| Inline object parser | ~1500 | ~300 | 80% |
| Enhanced element parser | ~3000 | ~400 | 70% |
| Planning/clock parser | ~400 | ~150 | 90% |
| Interpreter | ~800 | ~200 | 60% |
| Caching/performance | ~1000 | ~100 | N/A |
| **Total** | **~8000** | **~1350** | **75%** |

**Key insight**: We achieve 75% feature parity with ~17% of the code because:
1. No buffer abstraction layer needed
2. No deferred evaluation complexity
3. Simple caching via document versions
4. TypeScript's type system replaces runtime checks
5. We skip rarely-used element types

---

## Part 8: Compatibility Considerations

### 8.1 For Export Compatibility

If we want to export documents that match Emacs output:

```typescript
// Map our types to org-element types for export
const TYPE_MAPPING = {
  'src-block': 'src-block',     // Same
  'sourceBlock': 'src-block',   // Our legacy name → standard
  // ...
};

// Property name mapping
const PROPERTY_MAPPING = {
  'todoState': 'todo-keyword',
  'lineNumber': null,  // We don't export this
  // ...
};
```

### 8.2 For Document Interchange

If reading/writing org-element JSON (e.g., from pandoc):

```typescript
function fromOrgElement(data: any): OrgDocument {
  // Convert org-element JSON to our format
}

function toOrgElement(doc: OrgDocument): any {
  // Convert our format to org-element JSON
}
```

---

## Conclusion

### Adopt (High Value, Low Cost)
- Element type taxonomy
- Standard property names
- Object restrictions map
- Tree traversal patterns

### Adapt (Medium Value, Medium Cost)
- Position tracking (use offsets, convert to Position on demand)
- Parent references (compute on demand, not stored)
- Interpretation (simpler version)

### Skip (Low Value, High Cost)
- Buffer-centric parsing
- Deferred evaluation
- AVL-tree caching
- Complex secondary string handling
- Affiliated keyword association (defer to export phase)

### Bottom Line

**Don't rewrite from scratch.** The existing parser is solid. Enhance it incrementally:

1. Add element type definitions (~1 day)
2. Add inline object parser (~2 days)
3. Add position tracking to existing types (~1 day)
4. Add planning/clock parsing (~1 day)
5. Add interpreter for AST→text (~1 day)

Total: ~6 days of focused work for 75% org-element parity, sufficient for:
- Full Babel execution
- HTML/Markdown export
- Capture templates
- Enhanced agenda
- Time tracking

Full org-element parity (100%) would require ~4 weeks and is only needed for:
- Perfect export fidelity with Emacs
- Edge cases in complex documents
- Full LaTeX/Beamer export

---

## Part 9: LaTeX Export Requirements

LaTeX export is more demanding than HTML/Markdown and requires additional parser features. Here's what's specifically needed:

### 9.1 Critical Parser Additions for LaTeX

| Feature | Why Needed | Effort |
|---------|------------|--------|
| **Affiliated keywords** | #+CAPTION, #+NAME, #+LABEL, #+ATTR_LATEX | ~150 LOC |
| **LaTeX fragments** | `$inline$`, `$$display$$`, `\begin{equation}` | ~100 LOC |
| **LaTeX environments** | Pass through unchanged to output | ~50 LOC |
| **Entity parsing** | `\alpha`, `\rightarrow` → LaTeX commands | ~100 LOC |
| **Subscript/superscript** | `H_2O`, `x^2` → `H$_2$O`, `x$^2$` | ~50 LOC |
| **Table structure** | Cells, alignment, hlines, longtable support | ~200 LOC |
| **Footnote references** | `[fn:1]` → `\footnote{}` | ~50 LOC |

**Additional effort for LaTeX: ~700 LOC**

### 9.2 Affiliated Keywords (MUST IMPLEMENT)

For LaTeX export, affiliated keywords are **not optional**. They control:

```org
#+CAPTION: This is my figure caption
#+NAME: fig:my-figure
#+ATTR_LATEX: :width 0.8\textwidth :float t :placement [H]
[[file:image.png]]
```

**Parser changes needed:**

```typescript
interface AffiliatedKeywords {
  // Standard keywords
  caption?: string | [string, string];  // [short, long] caption
  name?: string;                         // For cross-references

  // Attribute keywords (per-backend)
  attr: {
    latex?: Record<string, string>;      // :width, :float, :placement, etc.
    html?: Record<string, string>;
    // ... other backends
  };

  // Results keywords (for Babel)
  results?: string[];
}

interface OrgElement {
  type: ElementType;
  range: { start: number; end: number };
  properties: ElementProperties;
  affiliated?: AffiliatedKeywords;  // ← ADD THIS
  children?: OrgElement[];
}
```

**Parsing strategy:**

```typescript
function parseAffiliatedKeywords(
  lines: string[],
  elementStartLine: number
): { affiliated: AffiliatedKeywords; consumedLines: number } {
  // Look backwards from element to collect #+KEYWORD lines
  const affiliated: AffiliatedKeywords = { attr: {} };
  let i = elementStartLine - 1;

  while (i >= 0) {
    const line = lines[i];

    // #+CAPTION: text
    const captionMatch = line.match(/^#\+CAPTION:\s*(.*)$/i);
    if (captionMatch) {
      affiliated.caption = captionMatch[1];
      i--;
      continue;
    }

    // #+NAME: identifier
    const nameMatch = line.match(/^#\+NAME:\s*(.*)$/i);
    if (nameMatch) {
      affiliated.name = nameMatch[1];
      i--;
      continue;
    }

    // #+ATTR_LATEX: :key value :key2 value2
    const attrMatch = line.match(/^#\+ATTR_(\w+):\s*(.*)$/i);
    if (attrMatch) {
      const backend = attrMatch[1].toLowerCase();
      const attrs = parseColonAttributes(attrMatch[2]);
      affiliated.attr[backend] = { ...affiliated.attr[backend], ...attrs };
      i--;
      continue;
    }

    // Not an affiliated keyword - stop
    break;
  }

  return { affiliated, consumedLines: elementStartLine - 1 - i };
}

function parseColonAttributes(text: string): Record<string, string> {
  // Parse ":key value :key2 value2" format
  const result: Record<string, string> = {};
  const regex = /:(\w+)\s+([^:]+?)(?=\s+:|$)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    result[match[1]] = match[2].trim();
  }
  return result;
}
```

### 9.3 LaTeX Fragment and Environment Parsing

**LaTeX fragments** (inline math, display math):

```typescript
type LatexFragmentType =
  | 'inline-math'      // $...$
  | 'display-math'     // $$...$$ or \[...\]
  | 'inline-command'   // \command or \command{arg}
  | 'environment';     // \begin{env}...\end{env}

interface LatexFragment extends OrgObject {
  type: 'latex-fragment';
  properties: {
    value: string;           // Raw LaTeX content
    fragmentType: LatexFragmentType;
  };
}

// Detection patterns
const LATEX_PATTERNS = {
  inlineMath: /\$([^\$\n]+)\$/g,
  displayMath: /\$\$([^\$]+)\$\$/g,
  displayMathBracket: /\\\[([\s\S]+?)\\\]/g,
  inlineMathParen: /\\\(([\s\S]+?)\\\)/g,
};

// Math environment names (pass through unchanged)
const MATH_ENVIRONMENTS = new Set([
  'equation', 'equation*', 'align', 'align*', 'gather', 'gather*',
  'multline', 'multline*', 'flalign', 'flalign*', 'alignat', 'alignat*',
  'eqnarray', 'eqnarray*', 'subequations',
  'matrix', 'pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix',
  'cases', 'dcases', 'rcases',
]);
```

**LaTeX environments** (block-level):

```typescript
interface LatexEnvironment extends OrgElement {
  type: 'latex-environment';
  properties: {
    name: string;            // Environment name
    value: string;           // Full content including \begin...\end
    options?: string;        // Optional [options]
  };
}

function parseLatexEnvironment(
  content: string,
  offset: number
): LatexEnvironment | null {
  const match = content.slice(offset).match(
    /^\\begin\{(\w+\*?)\}(\[.*?\])?([\s\S]*?)\\end\{\1\}/
  );
  if (!match) return null;

  return {
    type: 'latex-environment',
    range: { start: offset, end: offset + match[0].length },
    properties: {
      name: match[1],
      options: match[2],
      value: match[0],
    },
  };
}
```

### 9.4 Entity Parsing

Org entities like `\alpha`, `\rightarrow`, `\nbsp` need conversion:

```typescript
// Subset of org-entities - full list has ~400 entries
const ORG_ENTITIES: Record<string, { latex: string; html: string; utf8: string }> = {
  'alpha': { latex: '\\alpha', html: '&alpha;', utf8: 'α' },
  'beta': { latex: '\\beta', html: '&beta;', utf8: 'β' },
  'gamma': { latex: '\\gamma', html: '&gamma;', utf8: 'γ' },
  'rightarrow': { latex: '\\rightarrow', html: '&rarr;', utf8: '→' },
  'Rightarrow': { latex: '\\Rightarrow', html: '&rArr;', utf8: '⇒' },
  'nbsp': { latex: '~', html: '&nbsp;', utf8: '\u00A0' },
  'mdash': { latex: '---', html: '&mdash;', utf8: '—' },
  'ndash': { latex: '--', html: '&ndash;', utf8: '–' },
  'times': { latex: '\\times', html: '&times;', utf8: '×' },
  'div': { latex: '\\div', html: '&divide;', utf8: '÷' },
  // ... ~390 more
};

interface EntityObject extends OrgObject {
  type: 'entity';
  properties: {
    name: string;            // Entity name without backslash
    latex: string;           // LaTeX representation
    html: string;            // HTML representation
    utf8: string;            // UTF-8 character
    usesBrackets: boolean;   // \alpha vs \alpha{}
  };
}
```

### 9.5 Table Structure for LaTeX

LaTeX tables need detailed structure:

```typescript
interface OrgTable extends OrgElement {
  type: 'table';
  properties: {
    tableType: 'org' | 'table.el';

    // For LaTeX export
    environment?: string;    // tabular, longtable, tabularx, etc.
    alignment?: string;      // |l|c|r| or from #+ATTR_LATEX
    float?: boolean;         // Wrap in table environment
    placement?: string;      // [H], [htbp], etc.
    booktabs?: boolean;      // Use booktabs package

    // Caption/label from affiliated
    caption?: string;
    name?: string;           // For \label{}
  };
  children: OrgTableRow[];
}

interface OrgTableRow extends OrgElement {
  type: 'table-row';
  properties: {
    rowType: 'standard' | 'rule';  // Data row or horizontal line
  };
  children: OrgTableCell[];
}

interface OrgTableCell extends OrgObject {
  type: 'table-cell';
  properties: {
    value: string;           // Raw cell content
  };
  children?: OrgObject[];    // Parsed cell content (markup, links, etc.)
}
```

### 9.6 Cross-References and Labels

LaTeX cross-references require consistent label generation:

```typescript
interface LabelManager {
  // Generate label from #+NAME or CUSTOM_ID
  getLabel(element: OrgElement): string | undefined;

  // Generate automatic label if none provided
  generateLabel(element: OrgElement): string;

  // Resolve [[reference]] to \ref{label}
  resolveReference(target: string): { label: string; type: 'ref' | 'pageref' | 'nameref' } | undefined;
}

// Label generation strategy
function generateLabel(element: OrgElement, doc: OrgDocument): string {
  // Priority: #+NAME > CUSTOM_ID > auto-generated
  if (element.affiliated?.name) {
    return sanitizeLabel(element.affiliated.name);
  }

  if (element.properties.customId) {
    return sanitizeLabel(element.properties.customId);
  }

  // Auto-generate: fig:orgXXXXXX, tab:orgXXXXXX, sec:orgXXXXXX
  const prefix = getLabelPrefix(element.type);
  const hash = hashPosition(element.range.start);
  return `${prefix}:org${hash}`;
}

function getLabelPrefix(type: ElementType): string {
  switch (type) {
    case 'headline': return 'sec';
    case 'table': return 'tab';
    case 'paragraph': return 'fig';  // If contains image
    case 'src-block': return 'lst';
    case 'latex-environment': return 'eq';
    default: return 'org';
  }
}
```

### 9.7 Revised Effort Estimate (Including LaTeX)

| Component | Original | + LaTeX | Total |
|-----------|----------|---------|-------|
| Element types & interfaces | 200 | +50 | 250 |
| Inline object parser | 300 | +150 (entities, sub/super) | 450 |
| Enhanced element parser | 400 | +100 (latex-environment) | 500 |
| Planning/clock parser | 150 | - | 150 |
| Interpreter | 200 | - | 200 |
| **Affiliated keywords** | - | +150 | 150 |
| **Table structure** | - | +200 | 200 |
| **LaTeX fragments** | - | +100 | 100 |
| **Entity definitions** | - | +100 (data file) | 100 |
| **Caching/performance** | 100 | - | 100 |
| **Total** | **1350** | **+850** | **2200** |

### 9.8 LaTeX Export Backend (~800 LOC additional)

```typescript
// src/export/backends/exportLatex.ts

interface LatexExportOptions {
  // Document class
  documentClass: 'article' | 'report' | 'book' | 'beamer' | string;
  classOptions?: string[];  // [11pt, a4paper]

  // Packages
  packages: string[];       // Auto-detected + user-specified

  // Code blocks
  codeBackend: 'verbatim' | 'listings' | 'minted' | 'engraved';

  // Sections
  sectionNumbering: boolean;
  tocDepth: number;

  // Babel/Polyglossia
  language: string;
  usePolyglossia: boolean;

  // Output
  standalone: boolean;      // Include preamble
  outputFile?: string;
}

const latexTranscoders: ExportBackend['transcoders'] = {
  'headline': (el, contents, info) => {
    const level = el.properties.level!;
    const cmds = ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'];
    const cmd = cmds[Math.min(level - 1, cmds.length - 1)];
    const title = transcodeObjects(el.properties.title || [], info);
    const label = el.affiliated?.name ? `\\label{${el.affiliated.name}}` : '';
    return `\\${cmd}{${title}}${label}\n${contents}`;
  },

  'paragraph': (el, contents, info) => {
    // Check if paragraph contains only an image → figure environment
    if (isFigureParagraph(el)) {
      return transcodeFigure(el, info);
    }
    return `${contents}\n\n`;
  },

  'src-block': (el, contents, info) => {
    const lang = el.properties.language || '';
    const code = escapeLatex(el.properties.value || '');
    const caption = el.affiliated?.caption;
    const label = el.affiliated?.name;

    switch (info.options.codeBackend) {
      case 'minted':
        return `\\begin{minted}{${lang}}\n${code}\n\\end{minted}`;
      case 'listings':
        const opts = [
          caption && `caption={${caption}}`,
          label && `label=${label}`,
          lang && `language=${lang}`,
        ].filter(Boolean).join(',');
        return `\\begin{lstlisting}[${opts}]\n${code}\n\\end{lstlisting}`;
      default:
        return `\\begin{verbatim}\n${code}\n\\end{verbatim}`;
    }
  },

  'table': (el, contents, info) => {
    const attrs = el.affiliated?.attr?.latex || {};
    const env = attrs.environment || 'tabular';
    const align = attrs.align || inferAlignment(el);
    const caption = el.affiliated?.caption;
    const label = el.affiliated?.name;
    const booktabs = attrs.booktabs === 'yes';

    let result = '';
    if (attrs.float !== 'nil') {
      result += `\\begin{table}[${attrs.placement || 'htbp'}]\n`;
      result += `\\centering\n`;
    }
    result += `\\begin{${env}}{${align}}\n`;
    if (booktabs) result += `\\toprule\n`;
    result += contents;
    if (booktabs) result += `\\bottomrule\n`;
    result += `\\end{${env}}\n`;
    if (caption) result += `\\caption{${caption}}\n`;
    if (label) result += `\\label{${label}}\n`;
    if (attrs.float !== 'nil') {
      result += `\\end{table}\n`;
    }
    return result;
  },

  'latex-environment': (el) => {
    // Pass through unchanged
    return el.properties.value + '\n';
  },

  'latex-fragment': (el) => {
    return el.properties.value;
  },

  'entity': (el) => {
    return el.properties.latex;
  },

  'bold': (el, contents) => `\\textbf{${contents}}`,
  'italic': (el, contents) => `\\textit{${contents}}`,
  'underline': (el, contents) => `\\underline{${contents}}`,
  'strike-through': (el, contents) => `\\sout{${contents}}`,
  'code': (el) => `\\texttt{${escapeLatex(el.properties.value)}}`,
  'verbatim': (el) => `\\verb|${el.properties.value}|`,

  'link': (el, contents, info) => {
    const path = el.properties.path!;
    const type = el.properties.linkType;

    if (type === 'file' && isImageFile(path)) {
      // Image link
      const width = el.affiliated?.attr?.latex?.width || '0.7\\textwidth';
      return `\\includegraphics[width=${width}]{${path}}`;
    }

    if (type === 'http' || type === 'https') {
      return `\\href{${path}}{${contents || path}}`;
    }

    // Internal reference
    const label = info.labelManager.resolveReference(path);
    if (label) {
      return `\\ref{${label.label}}`;
    }

    return contents || path;
  },

  'footnote-reference': (el, contents) => {
    if (el.properties.type === 'inline') {
      return `\\footnote{${contents}}`;
    }
    // Named footnote - resolve from definitions
    return `\\footnote{${contents}}`;
  },

  // ... more transcoders
};
```

### 9.9 Summary: What LaTeX Export Adds

**Parser additions (REQUIRED):**
1. Affiliated keywords parsing → captions, labels, attributes
2. LaTeX fragment/environment detection → pass-through
3. Entity parsing → symbol conversion
4. Enhanced table structure → cell-level parsing
5. Subscript/superscript → inline math wrapping

**Export additions:**
1. LaTeX transcoder functions for all element types
2. Label manager for cross-references
3. Package detection (booktabs, minted, hyperref, etc.)
4. Preamble generation
5. Beamer support (future)

**Revised timeline:**
- Original estimate: ~6 days for 75% parity
- With LaTeX export: ~10 days for 85% parity
- Full LaTeX/Beamer parity: ~3 weeks

The affiliated keywords change is the most significant architectural addition. Once implemented, it benefits all export backends (HTML, Markdown, ODT, etc.).

---

## References

- [Org Element API](https://orgmode.org/worg/dev/org-element-api.html)
- [org-element.el source](https://github.com/bzg/org-mode/blob/main/lisp/org-element.el)
- [Org Syntax Specification](https://orgmode.org/worg/org-syntax.html)
- [VS Code TextDocument API](https://code.visualstudio.com/api/references/vscode-api#TextDocument)
