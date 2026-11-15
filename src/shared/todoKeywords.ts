/**
 * Pure (vscode-free) TODO keyword parsing, shared by the editor
 * (org/todoStates.ts) and the database indexer.
 * Supports #+TODO: and #+SEQ_TODO: in-buffer keywords
 *
 * Format: #+TODO: STATE1 STATE2 | DONE1 DONE2
 * The | separates active (incomplete) states from done (complete) states
 * If no | is present, the last state is considered done
 */

/**
 * Represents the TODO workflow states for a document
 */
export interface TodoWorkflow {
    /** All states in order for cycling */
    allStates: string[];
    /** Active (incomplete) states */
    activeStates: string[];
    /** Done (complete) states */
    doneStates: string[];
    /**
     * Each #+TODO line as its own sequence (active then done states), in file
     * order. Cycling stays within the sequence of the current keyword, as in
     * org-mode. Absent on hand-built workflows: treat allStates as one sequence.
     */
    sequences?: string[][];
    /**
     * Fast-selection keys declared as STATE(k) (org-todo fast access),
     * mapping state -> key. Empty when the file declares none.
     */
    fastKeys?: Record<string, string>;
}

/** Default TODO workflow when no custom states are defined */
export const DEFAULT_TODO_WORKFLOW: TodoWorkflow = {
    allStates: ['TODO', 'DONE'],
    activeStates: ['TODO'],
    doneStates: ['DONE'],
    sequences: [['TODO', 'DONE']],
    fastKeys: {}
};

/**
 * Split a keyword token into its state name and optional fast-selection key.
 *   TODO(t)    -> { state: 'TODO', key: 't' }
 *   WAIT(w@/!) -> { state: 'WAIT', key: 'w' }   (logging spec ignored)
 *   DONE(!)    -> { state: 'DONE' }              (logging only, no key)
 *   DONE       -> { state: 'DONE' }
 */
export function parseTodoKeywordToken(token: string): { state: string; key?: string } {
    const m = token.match(/^(.+?)\(([^()]*)\)$/);
    if (!m) return { state: token };
    const spec = m[2];
    const key = spec.length > 0 && !'@!/'.includes(spec[0]) ? spec[0] : undefined;
    return key ? { state: m[1], key } : { state: m[1] };
}

/** Extended default states recognized by the parser */
export const DEFAULT_TODO_STATES = [
    'TODO', 'NEXT', 'WAIT', 'WAITING', 'HOLD', 'SOMEDAY',
    'DONE', 'CANCELLED', 'CANCELED', 'IN-PROGRESS'
];

/**
 * Parse a #+TODO: or #+SEQ_TODO: line to extract workflow states
 *
 * Format examples:
 *   #+TODO: TODO REVIEW | DONE CANCELLED
 *   #+SEQ_TODO: PROPOSAL APPROVED | MERGED
 *   #+TODO: TODO DOING DONE  (no |, last state is done)
 */
export function parseTodoKeywordLine(line: string): TodoWorkflow | null {
    // Match #+TODO: or #+SEQ_TODO: (TYP_TODO is less common but also valid)
    // Markdown files may hide the line in a comment: <!-- #+TODO: A | B -->
    const match = line.match(/^(?:<!--\s*)?#\+(TODO|SEQ_TODO|TYP_TODO):\s*(.*?)(?:\s*-->)?\s*$/i);
    if (!match) {
        return null;
    }

    const statesString = match[2].trim();
    if (!statesString) {
        return null;
    }

    // Use the LAST | as the active/done separator. Multiple | groups collapse:
    // everything before the final | is active, everything after is done.
    // Stray '|' tokens in either section are filtered out.
    const pipeIndex = statesString.lastIndexOf('|');

    let activeStates: string[];
    let doneStates: string[];

    if (pipeIndex >= 0) {
        const beforePipe = statesString.slice(0, pipeIndex).trim();
        const afterPipe = statesString.slice(pipeIndex + 1).trim();

        activeStates = beforePipe.split(/\s+/).filter(s => s.length > 0 && s !== '|');
        doneStates = afterPipe.split(/\s+/).filter(s => s.length > 0 && s !== '|');
    } else {
        // No |, last state is done
        const allParsed = statesString.split(/\s+/).filter(s => s.length > 0);
        if (allParsed.length === 0) {
            return null;
        }
        if (allParsed.length === 1) {
            // Only one state, treat it as active (incomplete)
            activeStates = allParsed;
            doneStates = [];
        } else {
            // Last state is done
            activeStates = allParsed.slice(0, -1);
            doneStates = [allParsed[allParsed.length - 1]];
        }
    }

    if (activeStates.length === 0 && doneStates.length === 0) {
        return null;
    }

    const fastKeys: Record<string, string> = {};
    const strip = (tokens: string[]) => tokens.map(t => {
        const { state, key } = parseTodoKeywordToken(t);
        if (key) fastKeys[state] = key;
        return state;
    });
    activeStates = strip(activeStates);
    doneStates = strip(doneStates);
    const allStates = [...activeStates, ...doneStates];

    return {
        allStates,
        activeStates,
        doneStates,
        sequences: [allStates],
        fastKeys
    };
}

/**
 * Parse all TODO keyword definitions from document text
 * Multiple #+TODO: lines are combined into a single workflow
 */
export function parseTodoKeywords(content: string): TodoWorkflow | null {
    const lines = content.split('\n');
    const combinedActive: string[] = [];
    const combinedDone: string[] = [];
    const sequences: string[][] = [];
    const fastKeys: Record<string, string> = {};

    for (const line of lines) {
        // Stop parsing after first heading (keywords must be at top of file)
        if (line.match(/^\*+\s/)) {
            break;
        }

        const workflow = parseTodoKeywordLine(line);
        if (workflow) {
            combinedActive.push(...workflow.activeStates);
            combinedDone.push(...workflow.doneStates);
            sequences.push(...(workflow.sequences ?? [workflow.allStates]));
            for (const [state, key] of Object.entries(workflow.fastKeys ?? {})) {
                if (!(state in fastKeys)) fastKeys[state] = key;
            }
        }
    }

    if (combinedActive.length === 0 && combinedDone.length === 0) {
        return null;
    }

    // Remove duplicates while preserving order
    const uniqueActive = [...new Set(combinedActive)];
    const uniqueDone = [...new Set(combinedDone)];

    return {
        allStates: [...uniqueActive, ...uniqueDone],
        activeStates: uniqueActive,
        doneStates: uniqueDone,
        sequences,
        fastKeys
    };
}

/**
 * Next state when cycling forward, org-style: within the sequence that holds
 * the current keyword, and from its last state back to no keyword. With no
 * keyword, start the first sequence.
 */
export function nextTodoStateInWorkflow(currentState: string | undefined, workflow: TodoWorkflow): string {
    const sequences = workflow.sequences?.length ? workflow.sequences : [workflow.allStates];
    if (!currentState) return sequences[0]?.[0] ?? '';
    const seq = sequences.find(s => s.includes(currentState));
    if (!seq) return sequences[0]?.[0] ?? '';
    const i = seq.indexOf(currentState);
    return i + 1 < seq.length ? seq[i + 1] : '';
}

/** Previous state when cycling backward; mirror of nextTodoStateInWorkflow. */
export function previousTodoStateInWorkflow(currentState: string | undefined, workflow: TodoWorkflow): string {
    const sequences = workflow.sequences?.length ? workflow.sequences : [workflow.allStates];
    if (!currentState) {
        const first = sequences[0] ?? [];
        return first[first.length - 1] ?? '';
    }
    const seq = sequences.find(s => s.includes(currentState));
    if (!seq) return '';
    const i = seq.indexOf(currentState);
    return i > 0 ? seq[i - 1] : '';
}

/** True when the workflow declares at least one STATE(k) fast key. */
export function hasFastTodoKeys(workflow: TodoWorkflow): boolean {
    return Object.keys(workflow.fastKeys ?? {}).length > 0;
}
