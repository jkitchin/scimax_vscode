// What pycells.js needs from CodeMirror 6, bundled into codemirror.js (global `CM`).
// A lean setup: highlighting, undo, auto-indent, brackets, Tab to indent. No search/lint.
export { EditorView, keymap, drawSelection, highlightActiveLine } from "@codemirror/view";
export { EditorState, Prec } from "@codemirror/state";
export { history, historyKeymap, defaultKeymap, indentWithTab } from "@codemirror/commands";
export { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching, indentUnit } from "@codemirror/language";
export { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
export { python } from "@codemirror/lang-python";
